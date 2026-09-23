//! `bureau-hook` — Claude Code tells Bureau when it is waiting on you.
//!
//! The transcript already records every tool call, and Bureau reads it. What
//! the transcript never records is a DIALOG: when Claude Code stops to ask for
//! permission, or sits idle waiting for an answer, nothing is written until the
//! person has responded. That moment is the one a monitor exists for, and only
//! a hook can see it.
//!
//! Registered in Claude Code's settings by `installer-hook.ps1`:
//!
//!   "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command",
//!       "command": "<chemin>\\bureau-hook.exe", "args": [], "async": true }] }]
//!   "Notification":      [ …the same… ]
//!
//! `args` makes Claude Code spawn the executable directly instead of through a
//! shell. The first version was registered as a bare path, which Claude Code
//! hands to Git Bash on Windows — and bash reads `C:\Users\…` as escapes, turns
//! it into `C:Users…`, and fails with "command not found" on every single tool
//! call. It never ran once.
//!
//! `async` keeps it out of the way: Claude Code does not wait for it. It is
//! silent and always exits 0 regardless: a hook that fails, prints, or blocks
//! would interrupt the person's actual work, and no visualisation is worth that.
//!
//! Two more jobs, because this is the one program Claude Code already runs:
//!
//!   SessionStart         opens Bureau as the widget if it is not running
//!                        (see launch.rs for everything it refuses to do)
//!   bureau-hook --open   what `/desktips` runs: bring Bureau up, as the
//!     [--full|--show]    widget unless asked otherwise. Never reads stdin —
//!                        in this mode it may be a terminal, and would block.

use std::io::{Read, Write};

use bureau_core::evt::{bare_tool_name, tool_hint, ATTENTION};
use bureau_core::launch;
use bureau_core::solo::Request;
use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).map(|a| a.to_lowercase()).collect();
    if args.iter().any(|a| a == "--open") {
        // `/desktips grand` passes its words straight through, so the French
        // ones are understood as well as the flags.
        let has = |words: &[&str]| args.iter().any(|a| words.contains(&a.as_str()));
        let request = if has(&["--full", "full", "grand", "plein", "big"]) {
            Request::Full
        } else if has(&["--show", "show", "montre"]) {
            Request::Show
        } else {
            Request::Widget
        };
        // The one mode that talks: a person asked, and deserves an answer.
        // Always exit 0 — the skill that runs this is aborted on a failing
        // command, and the person would then see nothing at all.
        match launch::open(request) {
            Ok(said) => println!("{said}"),
            Err(e) => println!("Impossible d'ouvrir Bureau : {e}"),
        }
        return;
    }

    // Never let a problem here surface in someone's terminal.
    if let Err(e) = run() {
        let _ = writeln!(std::io::stderr(), "bureau-hook: {e}");
    }
}

fn run() -> std::io::Result<()> {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw)?;
    // Some shells put a byte-order mark in front of piped text, and serde
    // rejects it: the whole payload then read as empty.
    let v: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).unwrap_or(Value::Null);

    if v.get("hook_event_name").and_then(Value::as_str) == Some("SessionStart") {
        launch::open_for_session();
        return Ok(());
    }

    let Some((reason, detail)) = attention(&v) else { return Ok(()) };

    let get = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let session = match get("session_id") {
        s if s.is_empty() => "hook".to_string(),
        s => s,
    };
    let now = chrono::Utc::now();
    let line = json!({
        "type": ATTENTION,
        "bureauSource": "claude",
        "uuid": format!("hook-{}-{reason}", now.timestamp_millis()),
        "sessionId": session,
        "timestamp": now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "reason": reason,
        "detail": detail,
    });

    let dir = bureau_core::sources::ensure_drop_dir()?;
    let path = dir.join(format!("hook-{session}.jsonl"));
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{line}")?;
    Ok(())
}

/// What the person is being asked for, if this hook event is a request at all.
///
/// Tool calls themselves (Pre/PostToolUse, from an older registration) are
/// deliberately ignored: the transcript already carries them, and writing them
/// here as well put every tool call in the room twice.
fn attention(v: &Value) -> Option<(&'static str, String)> {
    let get = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("");
    match get("hook_event_name") {
        "PermissionRequest" => {
            let tool = get("tool_name");
            let hint = tool_hint(tool, v.get("tool_input"));
            let name = bare_tool_name(tool);
            Some(("permission", if hint.is_empty() { name.to_string() } else { format!("{name} · {hint}") }))
        }
        "Notification" => {
            let message = get("message");
            let kind = match get("notification_type") {
                "" => get("type"),
                k => k,
            };
            match kind {
                "permission_prompt" => Some(("permission", permission_tool(message))),
                "idle_prompt" => Some(("idle", String::new())),
                "elicitation_dialog" | "elicitation_url_dialog" | "agent_needs_input" =>
                    Some(("question", message.to_string())),
                // Older versions send no type at all: go by the wording.
                "" if message.contains("permission") => Some(("permission", permission_tool(message))),
                "" if message.contains("waiting for your input") => Some(("idle", String::new())),
                _ => None,
            }
        }
        _ => None,
    }
}

/// "Claude needs your permission to use Bash" → "Bash".
fn permission_tool(message: &str) -> String {
    message
        .split_once(" to use ")
        .map(|(_, tool)| tool.trim().trim_end_matches('.').to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_permission_request_names_the_tool_and_what_it_will_touch() {
        let v = json!({
            "hook_event_name": "PermissionRequest", "session_id": "s",
            "tool_name": "Bash", "tool_input": { "command": "npm test" },
        });
        assert_eq!(attention(&v), Some(("permission", "Bash · npm test".into())));
    }

    #[test]
    fn notifications_are_sorted_by_what_they_ask_for() {
        let perm = json!({ "hook_event_name": "Notification", "notification_type": "permission_prompt",
                           "message": "Claude needs your permission to use Write" });
        assert_eq!(attention(&perm), Some(("permission", "Write".into())));

        let idle = json!({ "hook_event_name": "Notification", "notification_type": "idle_prompt",
                           "message": "Claude is waiting for your input" });
        assert_eq!(attention(&idle), Some(("idle", String::new())));

        let done = json!({ "hook_event_name": "Notification", "notification_type": "auth_success" });
        assert_eq!(attention(&done), None, "only requests put a hand up");
    }

    #[test]
    fn tool_calls_are_left_to_the_transcript() {
        for e in ["PreToolUse", "PostToolUse"] {
            let v = json!({ "hook_event_name": e, "tool_name": "Read" });
            assert_eq!(attention(&v), None, "{e} would put every tool call in the room twice");
        }
    }
}
