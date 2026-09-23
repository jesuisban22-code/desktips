//! Normalized event type – converts any JSONL line from a Claude Code session
//! into a single strongly-typed Evt. Zero API calls, pure disk read.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::sources::Shape;

// ─── Raw JSONL shape (partial) ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RawLine {
    pub uuid: Option<String>,
    #[serde(rename = "parentUuid")]
    pub parent_uuid: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "isSidechain")]
    pub is_sidechain: Option<bool>,
    /// Sub-agents carry their OWN id here while sharing the parent's sessionId.
    /// Keying them by session — as this originally did — collapsed every
    /// sub-agent in a run into a single figure.
    #[serde(rename = "agentId")]
    pub agent_id: Option<String>,
    pub timestamp: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub message: Option<Value>,
    /// Lines Claude Code injects on its own (caveats, "continue from where you
    /// left off") look exactly like something the person typed.
    #[serde(rename = "isMeta")]
    pub is_meta: Option<bool>,
    /// Written by bureau-hook. Its lines land in the drop folder, but they are
    /// about a Claude Code session: without this they would be attributed to
    /// the folder and put a second, phantom figure in the room.
    #[serde(rename = "bureauSource")]
    pub bureau_source: Option<String>,
}

// ─── Normalized output ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum EvtKind {
    Thinking,
    Text { chars: usize },
    ToolStart { tool_id: String, name: String, hint: String },
    ToolEnd   { tool_id: String, ok: bool, ms: i64 },
    TurnEnd   { reason: String },
    Error     { message: String },
    /// Something the person typed. Clipped: it goes on a chalkboard, it is not
    /// an archive of the conversation.
    Prompt    { text: String },
    /// The assistant is stuck until the person does something: a permission
    /// dialog, a question, or an idle prompt. Only bureau-hook can see the
    /// first and last of those — the transcript never records a dialog.
    Attention { reason: String, detail: String },
    Unknown   { raw_kind: String },
}

/// A change to the assistant's task list, when it keeps one.
///
/// Claude Code has had two ways of doing it: `TodoWrite` hands over the whole
/// list every time, `TaskCreate`/`TaskUpdate` edit it one item at a time.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum TodoOp {
    Replace { items: Vec<TodoItem> },
    Add     { text: String },
    Update  { id: String, status: String },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TodoItem {
    pub text:   String,
    /// "pending", "in_progress" or "completed", as the tool wrote it.
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub input:       u64,
    pub output:      u64,
    pub cache_read:  u64,
    pub cache_write: u64,
    pub thinking:    u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Evt {
    /// Which assistant this came from: "claude", "codex", "gemini"…
    pub source:      String,
    pub id:          String,
    pub parent_id:   Option<String>,
    pub session_id:  String,
    pub agent_id:    String,       // "main" or sidechain session id
    pub is_subagent: bool,
    pub at:          i64,          // unix ms
    pub kind:        EvtKind,
    pub usage:       Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todo:        Option<TodoOp>,
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/// What the caller knows about a line before reading it.
#[derive(Debug, Clone, Copy)]
pub struct Ctx<'a> {
    pub source: &'a str,
    pub shape:  Shape,
    /// Used when a line carries no session id of its own — normally the file
    /// stem, which for every layout I have seen identifies the conversation.
    pub session_hint: &'a str,
}

pub fn parse_line_ctx(line: &str, ctx: Ctx) -> Option<Evt> {
    match ctx.shape {
        Shape::Anthropic => parse_anthropic(line, ctx),
        _ => parse_foreign(line, ctx),
    }
}

/// Kept for the Claude-only path and the test harnesses.
pub fn parse_line(line: &str) -> Option<Evt> {
    parse_line_ctx(line, Ctx { source: "claude", shape: Shape::Anthropic, session_hint: "" })
}

/// Line types Claude Code writes for its own bookkeeping. Anything NOT on this
/// list that we fail to recognise still comes through as `Unknown`, so a new
/// line type shows up in the log instead of disappearing.
const BOOKKEEPING: &[&str] = &[
    "attachment", "mode", "atis-latch", "frame-link", "last-prompt",
    "summary", "file-history-snapshot", "queued-command", "progress",
    "diagnostic", "compact-boundary", "queue-operation",
    // Newer versions, counted in the last 25 transcripts on this machine:
    // custom-title ×1037 and ai-title ×708 alone put more "?" rows in the
    // journal than there were tool calls.
    "custom-title", "ai-title", "bridge-session", "agent-name",
    "file-history-delta", "permission-mode", "fork-context-ref", "cost-state",
];

fn parse_anthropic(line: &str, ctx: Ctx) -> Option<Evt> {
    let raw: RawLine = serde_json::from_str(line).ok()?;

    let id         = raw.uuid.clone().unwrap_or_else(|| uuid_fallback(line));
    let session_id = raw.session_id.clone().unwrap_or_default();
    let is_sub     = raw.is_sidechain.unwrap_or(false);
    let agent_id = if is_sub {
        raw.agent_id.clone().unwrap_or_else(|| session_id.clone())
    } else {
        "main".into()
    };
    let at         = parse_ts(raw.timestamp.as_deref());

    let msg = raw.message.as_ref();

    // ── usage ──────────────────────────────────────────────────────────────
    let usage = msg.and_then(|m| {
        let u = m.get("usage")?;
        Some(Usage {
            input:       u.get("input_tokens")            .and_then(Value::as_u64).unwrap_or(0),
            output:      u.get("output_tokens")           .and_then(Value::as_u64).unwrap_or(0),
            cache_read:  u.get("cache_read_input_tokens") .and_then(Value::as_u64).unwrap_or(0),
            cache_write: u.get("cache_creation_input_tokens").and_then(Value::as_u64).unwrap_or(0),
            thinking:    u.get("thinking_tokens")         .and_then(Value::as_u64).unwrap_or(0),
        })
    });

    // ── kind ───────────────────────────────────────────────────────────────
    let raw_kind = raw.kind.as_deref().unwrap_or("unknown").to_string();

    // Bookkeeping lines are not moments in a conversation. A real session
    // writes several of these per turn, and letting them through as Unknown
    // filled the event log with "atis-latch" and made the animation queue
    // several times longer than the work it was meant to show.
    if BOOKKEEPING.contains(&raw_kind.as_str()) {
        return None
    }

    let mut todo = None;
    let kind = match raw_kind.as_str() {
        "assistant" => {
            let (kind, op) = parse_assistant_kind(msg);
            todo = op;
            kind
        }
        "user"      => parse_user_kind(msg, raw.is_meta.unwrap_or(false)),
        "system"    => EvtKind::TurnEnd { reason: "system".into() },
        ATTENTION   => parse_attention(line),
        other       => EvtKind::Unknown { raw_kind: other.into() },
    };

    Some(Evt {
        source: raw.bureau_source.clone().unwrap_or_else(|| ctx.source.to_string()),
        id,
        parent_id: raw.parent_uuid,
        session_id,
        agent_id,
        is_subagent: is_sub,
        at,
        kind,
        usage,
        todo,
    })
}

/// The line type bureau-hook writes when the assistant is waiting on the
/// person. Not a Claude Code type: nothing else produces it.
pub const ATTENTION: &str = "bureau_attention";

fn parse_attention(line: &str) -> EvtKind {
    let v: Value = serde_json::from_str(line).unwrap_or(Value::Null);
    let get = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let reason = match get("reason").as_str() {
        r @ ("permission" | "question" | "idle") => r.to_string(),
        _ => "permission".to_string(),
    };
    EvtKind::Attention { reason, detail: clip(&get("detail"), 90) }
}

/// A `user` line is usually the transcript carrying tool RESULTS back, not a
/// person typing. Routing every one of them to TurnEnd — as this did
/// originally — meant no tool ever registered as finished and no failure ever
/// surfaced, which is why `EvtKind::Error` was dead code.
fn parse_user_kind(msg: Option<&Value>, is_meta: bool) -> EvtKind {
    let content = msg.and_then(|m| m.get("content"));

    let blocks = match content {
        Some(Value::Array(c)) => c,
        // Content is a bare string: a real person typed something.
        Some(Value::String(s)) => return typed(&[s.as_str()], is_meta),
        _ => return EvtKind::TurnEnd { reason: "user_turn".into() },
    };

    for block in blocks {
        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
            continue
        }
        let tool_id = block
            .get("tool_use_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();

        // A failed tool is surfaced as an error in its own right, not as a
        // tool_end that merely happens to carry ok: false. The HUD styles
        // errors differently, and a silent failure is the one thing a watching
        // tool must not hide.
        if block.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
            return EvtKind::Error { message: result_message(block) }
        }
        return EvtKind::ToolEnd { tool_id, ok: true, ms: 0 }
    }

    // No tool result: text blocks, which is how newer versions record a prompt
    // (often after an <ide_opened_file> block saying which file was open).
    let texts: Vec<&str> = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect();
    typed(&texts, is_meta)
}

/// What the person actually typed, once Claude Code's own wrappers are gone.
///
/// Measured on this machine's transcripts: a "user" line with text is as often
/// `<ide_opened_file>`, `<command-name>/model</command-name>`, a local command's
/// output or `[Request interrupted by user]` as it is a request. Putting those
/// on the chalkboard would have been worse than leaving it blank.
fn typed(texts: &[&str], is_meta: bool) -> EvtKind {
    let turn = |reason: &str| EvtKind::TurnEnd { reason: reason.into() };
    if is_meta {
        return turn("user_turn")
    }
    let mut kept: Vec<&str> = Vec::new();
    for t in texts {
        let t = t.trim();
        if t.starts_with("[Request interrupted") {
            return turn("interrupted")
        }
        if t.is_empty() || is_wrapper(t) {
            continue
        }
        kept.push(t);
    }
    if kept.is_empty() {
        return turn("user_turn")
    }
    EvtKind::Prompt { text: clip(&kept.join(" "), 280) }
}

/// `<some-tag>…</some-tag>`: a block Claude Code wrote, not the person.
fn is_wrapper(t: &str) -> bool {
    let Some(rest) = t.strip_prefix('<') else { return false };
    let tag: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    !tag.is_empty() && t.contains(&format!("</{tag}>"))
}

fn parse_assistant_kind(msg: Option<&Value>) -> (EvtKind, Option<TodoOp>) {
    let msg = match msg { Some(m) => m, None => return (EvtKind::Unknown { raw_kind: "assistant_empty".into() }, None) };
    let content = match msg.get("content").and_then(Value::as_array) {
        Some(c) => c,
        None    => return (EvtKind::Unknown { raw_kind: "assistant_no_content".into() }, None),
    };

    // Scan content blocks; prefer tool_use, then thinking, then text
    let mut found_text_chars = 0usize;
    let mut found_thinking = false;

    for block in content {
        let t = block.get("type").and_then(Value::as_str).unwrap_or("");
        match t {
            "tool_use" => {
                let tool_id = block.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let name    = block.get("name").and_then(Value::as_str).unwrap_or("unknown").to_string();
                let hint    = tool_hint(&name, block.get("input"));
                let todo    = todo_op(&name, block.get("input"));
                return (EvtKind::ToolStart { tool_id, name, hint }, todo);
            }
            "thinking" => { found_thinking = true; }
            "text" => {
                found_text_chars += block.get("text")
                    .and_then(Value::as_str)
                    .map(|s| s.len())
                    .unwrap_or(0);
            }
            _ => {}
        }
    }

    if found_thinking { return (EvtKind::Thinking, None); }
    if found_text_chars > 0 { return (EvtKind::Text { chars: found_text_chars }, None); }
    (EvtKind::Unknown { raw_kind: "assistant_empty_content".into() }, None)
}

/// The task-list change a tool call makes, if it is one of the task tools.
pub fn todo_op(name: &str, input: Option<&Value>) -> Option<TodoOp> {
    let input = input?;
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    match bare_tool_name(name) {
        "TodoWrite" => {
            let items = input.get("todos")?.as_array()?
                .iter()
                .filter_map(|t| Some(TodoItem {
                    text:   clip(&s(t, "content").or_else(|| s(t, "activeForm"))?, 90),
                    status: s(t, "status").unwrap_or_else(|| "pending".into()),
                }))
                .collect();
            Some(TodoOp::Replace { items })
        }
        "TaskCreate" => {
            let text = s(input, "subject").or_else(|| s(input, "description"))?;
            Some(TodoOp::Add { text: clip(&text, 90) })
        }
        "TaskUpdate" => {
            let id = s(input, "taskId").or_else(|| s(input, "task_id")).or_else(|| s(input, "id"))?;
            let status = s(input, "status")?;
            Some(TodoOp::Update { id, status })
        }
        _ => None,
    }
}

/// `mcp__Roblox_Studio__execute_luau` → `execute_luau`. The server prefix says
/// where a tool lives, not what it does.
pub fn bare_tool_name(name: &str) -> &str {
    match name.strip_prefix("mcp__") {
        Some(rest) => rest.split_once("__").map(|(_, tool)| tool).unwrap_or(rest),
        None => name,
    }
}

/// Pull a short, human-readable message out of a tool_result block. The content
/// is sometimes a plain string and sometimes an array of blocks, so handle both
/// and truncate — an error dumped whole would flood the event log.
fn result_message(block: &Value) -> String {
    // Foreign shapes carry the payload under other keys; try those first so a
    // real error message survives instead of degrading to "tool failed".
    for k in ["output", "stderr", "result", "error", "message", "text"] {
        match block.get(k) {
            Some(Value::String(s)) if !s.trim().is_empty() => {
                // Some tools wrap the real text in another JSON blob.
                if let Ok(inner) = serde_json::from_str::<Value>(s) {
                    let nested = result_message(&inner);
                    if nested != "tool failed" { return nested }
                }
                return clip(s, 90)
            }
            Some(v) if v.is_object() => {
                let nested = result_message(v);
                if nested != "tool failed" { return nested }
            }
            _ => {}
        }
    }

    let raw = match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    };
    let cleaned = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return "tool failed".into();
    }
    clip(&cleaned, 90)
}

/// What a tool call is about, in a few words: the file, the command, the query.
/// Empty when nothing useful can be said — repeating the tool's own name, as
/// this used to for every tool it did not know, printed "X · X".
pub fn tool_hint(name: &str, input: Option<&Value>) -> String {
    let Some(input) = input else { return String::new() };
    let s = |k: &str| input.get(k).and_then(Value::as_str).filter(|v| !v.trim().is_empty());
    let hint = match bare_tool_name(name) {
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" =>
            s("file_path").or_else(|| s("notebook_path")).map(short_path),
        "Bash" | "PowerShell" => s("command").map(|c| clip(c, 40)),
        "WebSearch" => s("query").map(|q| clip(q, 40)),
        "WebFetch" => s("url").map(|u| clip(u, 40)),
        "Glob" | "Grep" => s("pattern").map(|p| clip(p, 40)),
        "Agent" | "Task" => s("description").map(|d| clip(d, 40)),
        "Skill" => s("skill").or_else(|| s("command")).map(str::to_string),
        "TaskCreate" => s("subject").map(|t| clip(t, 40)),
        "TodoWrite" => input.get("todos").and_then(Value::as_array)
            .map(|t| format!("{} tâche{}", t.len(), if t.len() > 1 { "s" } else { "" })),
        "AskUserQuestion" => input.get("questions").and_then(Value::as_array)
            .and_then(|q| q.first())
            .and_then(|q| q.get("question").and_then(Value::as_str))
            .map(|q| clip(q, 60)),
        _ => None,
    };
    if let Some(h) = hint {
        return h
    }
    // Anything else, MCP tools included: the argument that best names it.
    for k in ["file_path", "path", "command", "code", "query", "pattern", "url", "description", "name", "prompt"] {
        if let Some(v) = s(k) {
            return if k.ends_with("path") { short_path(v) } else { clip(v, 40) }
        }
    }
    String::new()
}

/// The last component of a path, whichever separator the OS used. Splitting on
/// `/` alone left every Windows path whole: `C:\Users\…\watcher.rs`.
fn short_path(p: &str) -> String {
    p.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(p)
        .to_string()
}

fn parse_ts(ts: Option<&str>) -> i64 {
    ts.and_then(|s| {
        chrono::DateTime::parse_from_rfc3339(s).ok()
            .map(|dt| dt.timestamp_millis())
    }).unwrap_or(0)
}

fn uuid_fallback(line: &str) -> String {
    // Use a hash of the line as a stable id when uuid is absent
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    line.hash(&mut h);
    format!("{:016x}", h.finish())
}

// ═══════════════════════════════════════════════════════════════════════════
// Foreign shapes
// ═══════════════════════════════════════════════════════════════════════════
//
// Every other assistant writes its own JSON, several have changed it between
// releases, and I cannot test most of them. So rather than a brittle parser per
// tool pinned to documentation that may already be stale, this sniffs for the
// SHAPE of an event wherever it sits in the line.
//
// The rule it relies on holds across all of them: somewhere in the object there
// is a discriminator naming what happened, and — for a tool call — a sibling
// carrying the tool's name. Codex nests that under `payload`, Copilot under
// `event`, others put it at the top level, so the search is recursive and
// depth-bounded rather than positional.
//
// When nothing matches, the line becomes `Unknown` and is dropped downstream.
// A source whose format has moved on therefore shows fewer event kinds. It
// never crashes, and it never invents an event that did not happen.

/// Keys a timestamp might hide behind.
const TS_KEYS: &[&str] = &["timestamp", "ts", "time", "createdAt", "created_at", "date"];
/// Discriminator values that mean "a tool was invoked".
const CALL_TYPES: &[&str] = &[
    "function_call", "tool_call", "tool_use", "custom_tool_call",
    "local_shell_call", "toolCall", "tool-call", "command",
];
/// Discriminator values that mean "a tool came back".
const RESULT_TYPES: &[&str] = &[
    "function_call_output", "tool_call_output", "tool_result",
    "custom_tool_call_output", "local_shell_call_output", "toolResult", "tool-result",
];
/// Discriminator values that mean "the model reasoned".
const THINK_TYPES: &[&str] = &["reasoning", "thinking", "thought", "reasoning_summary"];
/// Discriminator values that mean "the model wrote prose".
const TEXT_TYPES: &[&str] = &["message", "assistant", "text", "output_text", "agent_message"];
/// Keys a tool's name might hide behind.
const NAME_KEYS: &[&str] = &["name", "tool", "toolName", "tool_name", "command", "function"];

fn str_at<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(Value::as_str) {
            if !s.is_empty() { return Some(s) }
        }
    }
    None
}

/// The discriminator of an object, wherever this tool chose to put it.
fn kind_of(v: &Value) -> Option<&str> {
    str_at(v, &["type", "kind", "event", "eventType", "event_type", "role"])
}

/// A tool's name, allowing for `function: { name }` nesting.
fn tool_name(v: &Value) -> Option<String> {
    if let Some(n) = str_at(v, NAME_KEYS) {
        return Some(n.to_string())
    }
    if let Some(f) = v.get("function") {
        if let Some(n) = str_at(f, &["name"]) { return Some(n.to_string()) }
    }
    None
}

/// What a sniffed object turned out to be.
enum Sniff {
    Call { name: String, hint: String },
    Result { ok: bool, message: String },
    Think,
    Text { chars: usize },
}

/// Walk the line looking for the first object that reads as an event.
fn sniff(v: &Value, depth: usize) -> Option<Sniff> {
    if depth > 5 { return None }

    if let Some(obj) = v.as_object() {
        if let Some(k) = kind_of(v) {
            if CALL_TYPES.iter().any(|t| t.eq_ignore_ascii_case(k)) {
                let name = tool_name(v).unwrap_or_else(|| "outil".into());
                let hint = foreign_hint(v, &name);
                return Some(Sniff::Call { name, hint })
            }
            if RESULT_TYPES.iter().any(|t| t.eq_ignore_ascii_case(k)) {
                let ok = !is_failure(v);
                return Some(Sniff::Result { ok, message: result_message(v) })
            }
            if THINK_TYPES.iter().any(|t| t.eq_ignore_ascii_case(k)) {
                return Some(Sniff::Think)
            }
            if TEXT_TYPES.iter().any(|t| t.eq_ignore_ascii_case(k)) {
                if let Some(n) = text_length(v) {
                    return Some(Sniff::Text { chars: n })
                }
            }
        }
        // Not itself an event; look inside the usual envelopes first so the
        // real payload wins over incidental nested objects.
        for key in ["payload", "item", "event", "data", "message", "body"] {
            if let Some(inner) = obj.get(key) {
                if let Some(s) = sniff(inner, depth + 1) { return Some(s) }
            }
        }
        for (_, inner) in obj {
            if inner.is_object() || inner.is_array() {
                if let Some(s) = sniff(inner, depth + 1) { return Some(s) }
            }
        }
    }

    if let Some(arr) = v.as_array() {
        for inner in arr {
            if let Some(s) = sniff(inner, depth + 1) { return Some(s) }
        }
    }

    None
}

/// How much prose a message-ish record holds, if any.
fn text_length(v: &Value) -> Option<usize> {
    for k in ["text", "content", "message", "output_text"] {
        match v.get(k) {
            Some(Value::String(s)) if !s.trim().is_empty() => return Some(s.len()),
            Some(Value::Array(items)) => {
                let n: usize = items.iter()
                    .filter_map(|b| b.get("text").and_then(Value::as_str).map(str::len))
                    .sum();
                if n > 0 { return Some(n) }
            }
            _ => {}
        }
    }
    None
}

fn is_failure(v: &Value) -> bool {
    if v.get("is_error").and_then(Value::as_bool).unwrap_or(false) { return true }
    if v.get("isError").and_then(Value::as_bool).unwrap_or(false) { return true }
    if let Some(false) = v.get("success").and_then(Value::as_bool) { return true }
    // A non-zero exit code is a failure however the tool spells the key.
    for k in ["exit_code", "exitCode", "status_code"] {
        if let Some(n) = v.get(k).and_then(Value::as_i64) {
            if n != 0 { return true }
        }
    }
    false
}

/// A short label for a foreign tool call: the argument that best identifies it.
fn foreign_hint(v: &Value, name: &str) -> String {
    // Arguments are sometimes a JSON string, sometimes an object.
    let args = v.get("arguments").or_else(|| v.get("args")).or_else(|| v.get("input"));
    let parsed: Option<Value> = match args {
        Some(Value::String(s)) => serde_json::from_str(s).ok(),
        Some(other) => Some(other.clone()),
        None => None,
    };
    if let Some(a) = parsed {
        for k in ["command", "cmd", "file_path", "path", "file", "query", "pattern", "url", "description"] {
            if let Some(s) = a.get(k).and_then(Value::as_str) {
                return clip(s, 42)
            }
            // Codex writes shell commands as an argv array.
            if let Some(arr) = a.get(k).and_then(Value::as_array) {
                let joined = arr.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ");
                if !joined.is_empty() { return clip(&joined, 42) }
            }
        }
    }
    name.to_string()
}

fn clip(s: &str, n: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = flat.chars().take(n).collect();
    if flat.chars().count() > n { out.push('…') }
    out
}

/// Timestamp from any of the usual keys, in RFC3339 or epoch millis/seconds.
fn foreign_ts(v: &Value) -> i64 {
    for k in TS_KEYS {
        match v.get(*k) {
            Some(Value::String(s)) => {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                    return dt.timestamp_millis()
                }
            }
            Some(Value::Number(n)) => {
                if let Some(i) = n.as_i64() {
                    // Heuristic: anything below this is seconds, not millis.
                    return if i < 100_000_000_000 { i * 1000 } else { i }
                }
            }
            _ => {}
        }
    }
    0
}

fn parse_foreign(line: &str, ctx: Ctx) -> Option<Evt> {
    let v: Value = serde_json::from_str(line).ok()?;

    let session_id = str_at(&v, &["session_id", "sessionId", "conversationId", "conversation_id"])
        .map(str::to_string)
        .unwrap_or_else(|| ctx.session_hint.to_string());

    let id = str_at(&v, &["id", "uuid", "eventId", "event_id"])
        .map(str::to_string)
        .unwrap_or_else(|| uuid_fallback(line));

    let at = match foreign_ts(&v) { 0 => 0, t => t };

    let kind = match sniff(&v, 0) {
        Some(Sniff::Call { name, hint }) =>
            EvtKind::ToolStart { tool_id: id.clone(), name, hint },
        Some(Sniff::Result { ok, message }) => {
            if ok { EvtKind::ToolEnd { tool_id: id.clone(), ok: true, ms: 0 } }
            else  { EvtKind::Error { message } }
        }
        Some(Sniff::Think) => EvtKind::Thinking,
        Some(Sniff::Text { chars }) => EvtKind::Text { chars },
        None => EvtKind::Unknown { raw_kind: kind_of(&v).unwrap_or("?").to_string() },
    };

    let usage = v.get("usage").or_else(|| v.get("token_usage")).map(|u| Usage {
        input:       num(u, &["input_tokens", "inputTokens", "prompt_tokens"]),
        output:      num(u, &["output_tokens", "outputTokens", "completion_tokens"]),
        cache_read:  num(u, &["cache_read_input_tokens", "cached_input_tokens", "cachedTokens"]),
        cache_write: num(u, &["cache_creation_input_tokens"]),
        thinking:    num(u, &["reasoning_tokens", "thinking_tokens"]),
    });

    Some(Evt {
        source: ctx.source.to_string(),
        id,
        parent_id: None,
        session_id,
        agent_id: "main".into(),
        is_subagent: false,
        at,
        kind,
        usage,
        todo: None,
    })
}

fn num(v: &Value, keys: &[&str]) -> u64 {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(Value::as_u64) { return n }
    }
    0
}
