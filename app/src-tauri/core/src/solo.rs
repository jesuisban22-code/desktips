//! One Bureau at a time.
//!
//! WHY THIS EXISTS. Closing Bureau hides it instead of quitting — it is a
//! monitor, it should keep watching. But that means the desktop icon is a trap:
//! double-clicking it starts a SECOND process, which opens its own window, with
//! its own empty room, while the real one goes on working behind it. Watching
//! that happen on the user's machine, nothing distinguished it from the app
//! being broken.
//!
//! The usual answer is `tauri-plugin-single-instance`. This is forty lines of
//! `std::net` instead, for two reasons: it adds no dependency to a build that
//! has already broken twice on this user's machine and takes fifteen minutes
//! each time, and — unlike a plugin the shell can only exercise on Windows —
//! it can be tested here.
//!
//! How it works: the first instance holds a loopback listener. A later one
//! fails to bind, connects instead, says what it wanted, and exits; the first
//! one hears the request and acts on it. The same line is how the Claude Code
//! hook asks "are you there?" at the start of a session without dragging the
//! window in front of whatever the person is typing in.
//!
//! Failure is always resolved in favour of STARTING. A port held by something
//! else, a firewall, a machine with loopback locked down — none of those are
//! reasons to refuse to open the app. The worst case is the old behaviour.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::time::Duration;

/// Arbitrary, in the dynamic range, and unlikely to collide.
pub const PORT: u16 = 51733;

/// The answer to every request, so Bureau never mistakes an unrelated service
/// for another Bureau.
const HELLO: &[u8] = b"BUREAU/1 hello\n";
/// No request line is longer than this; anything that is, is not Bureau.
const MAX_LINE: usize = 32;

const IO_TIMEOUT: Duration = Duration::from_millis(600);

/// What a second launch, or the hook, asks of the running Bureau.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    /// Bring the window back, as it was.
    Show,
    /// Bring it back small, borderless and on top.
    Widget,
    /// Bring it back full size.
    Full,
    /// Only asking whether a Bureau is running. Nothing moves.
    Ping,
}

impl Request {
    fn line(self) -> &'static [u8] {
        match self {
            // "knock" is what the first version sent; a newer launch talking
            // to an older Bureau still gets its window back.
            Request::Show   => b"BUREAU/1 knock\n",
            Request::Widget => b"BUREAU/1 widget\n",
            Request::Full   => b"BUREAU/1 full\n",
            Request::Ping   => b"BUREAU/1 ping\n",
        }
    }

    fn parse(line: &[u8]) -> Option<Request> {
        [Request::Show, Request::Widget, Request::Full, Request::Ping]
            .into_iter()
            .find(|r| r.line() == line)
    }
}

pub enum Claim {
    /// This process is the one. Hand the listener to [`serve`].
    First(TcpListener),
    /// Another Bureau is already running and has been given the request.
    /// The caller should exit without opening a window.
    Already,
    /// Start the app, but the guard is not in place: something else holds the
    /// port, or loopback is unavailable. A second window is a nuisance;
    /// refusing to open at all is a broken app. Always choose the nuisance.
    Unguarded,
}

fn addr(port: u16) -> SocketAddrV4 {
    SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)
}

/// Try to become the single instance.
///
/// Note the bind is to 127.0.0.1 specifically, not 0.0.0.0: Windows raises a
/// firewall prompt for a program that listens on a real interface, and a
/// firewall prompt on first launch would be a worse first impression than the
/// bug this fixes.
pub fn claim() -> Claim {
    claim_with(PORT, Request::Show)
}

pub fn claim_on(port: u16) -> Claim {
    claim_with(port, Request::Show)
}

/// As [`claim`], passing `request` on to the running Bureau if there is one.
pub fn claim_with(port: u16, request: Request) -> Claim {
    match TcpListener::bind(addr(port)) {
        Ok(listener) => Claim::First(listener),
        Err(_) => {
            if send(port, request) {
                Claim::Already
            } else {
                Claim::Unguarded
            }
        }
    }
}

/// Give a running Bureau a request. True only if a Bureau answered.
pub fn send(port: u16, request: Request) -> bool {
    let Ok(mut sock) = TcpStream::connect_timeout(&addr(port).into(), IO_TIMEOUT) else {
        return false;
    };
    let _ = sock.set_read_timeout(Some(IO_TIMEOUT));
    let _ = sock.set_write_timeout(Some(IO_TIMEOUT));
    if sock.write_all(request.line()).is_err() {
        return false;
    }
    let _ = sock.flush();

    let mut buf = [0u8; HELLO.len()];
    let mut got = 0;
    while got < buf.len() {
        match sock.read(&mut buf[got..]) {
            Ok(0) => break,
            Ok(n) => got += n,
            Err(_) => break,
        }
    }
    &buf[..got] == HELLO
}

/// Is a Bureau running? Asks without disturbing it.
pub fn running() -> bool {
    send(PORT, Request::Ping)
}

/// Read one request line, up to and including its newline.
fn read_line(sock: &mut TcpStream) -> Vec<u8> {
    let mut line = Vec::with_capacity(MAX_LINE);
    let mut byte = [0u8; 1];
    while line.len() < MAX_LINE {
        match sock.read(&mut byte) {
            Ok(1) => {
                line.push(byte[0]);
                if byte[0] == b'\n' {
                    break;
                }
            }
            _ => break,
        }
    }
    line
}

/// Answer requests for the life of the process, calling `act` for each one
/// that asks for something (a ping only gets its hello).
///
/// Spawns its own thread and returns immediately: this must never be able to
/// hold up the window.
pub fn serve<F>(listener: TcpListener, act: F)
where
    F: Fn(Request) + Send + 'static,
{
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut sock) = stream else { continue };
            let _ = sock.set_read_timeout(Some(IO_TIMEOUT));
            let _ = sock.set_write_timeout(Some(IO_TIMEOUT));

            let Some(request) = Request::parse(&read_line(&mut sock)) else { continue };
            let _ = sock.write_all(HELLO);
            let _ = sock.flush();
            if request != Request::Ping {
                act(request);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Pick a free port so the tests never fight each other or a real Bureau.
    fn free_port() -> u16 {
        TcpListener::bind(addr(0))
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .expect("loopback")
    }

    /// A running Bureau on a free port, recording what it was asked.
    fn running_bureau() -> (u16, Arc<Mutex<Vec<Request>>>) {
        let port = free_port();
        let Claim::First(listener) = claim_on(port) else {
            panic!("first claim should have succeeded")
        };
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = Arc::clone(&seen);
        serve(listener, move |r| s.lock().unwrap().push(r));
        (port, seen)
    }

    fn wait_for(seen: &Arc<Mutex<Vec<Request>>>, n: usize) {
        for _ in 0..50 {
            if seen.lock().unwrap().len() >= n {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn the_first_instance_takes_the_port() {
        let port = free_port();
        assert!(matches!(claim_on(port), Claim::First(_)));
    }

    #[test]
    fn a_second_instance_is_told_to_stand_down_and_the_first_is_woken() {
        let (port, seen) = running_bureau();
        assert!(matches!(claim_on(port), Claim::Already));
        wait_for(&seen, 1);
        assert_eq!(*seen.lock().unwrap(), vec![Request::Show], "la fenêtre n'a pas été réveillée");
    }

    #[test]
    fn a_launch_can_ask_for_the_widget() {
        let (port, seen) = running_bureau();
        assert!(matches!(claim_with(port, Request::Widget), Claim::Already));
        wait_for(&seen, 1);
        assert_eq!(*seen.lock().unwrap(), vec![Request::Widget]);
    }

    /// The hook asks at the start of every Claude Code session. Answering must
    /// not pull the window in front of the person's typing.
    #[test]
    fn a_ping_is_answered_without_moving_anything() {
        let (port, seen) = running_bureau();
        assert!(send(port, Request::Ping), "a running Bureau must answer a ping");
        std::thread::sleep(Duration::from_millis(150));
        assert!(seen.lock().unwrap().is_empty(), "a ping woke the window");
        assert!(!send(free_port(), Request::Ping), "nothing there, nothing answered");
    }

    /// A port held by something that is NOT Bureau must not stop Bureau from
    /// starting. Refusing to open because a stranger holds a port would be a
    /// far worse bug than the one this module fixes.
    #[test]
    fn a_stranger_on_the_port_does_not_keep_bureau_shut() {
        let port = free_port();
        let squatter = TcpListener::bind(addr(port)).expect("bind");
        std::thread::spawn(move || {
            for stream in squatter.incoming() {
                // Accept and say nothing, like a service that speaks another
                // protocol and is waiting for us to go first.
                let _ = stream;
                std::thread::sleep(Duration::from_millis(50));
            }
        });

        assert!(matches!(claim_on(port), Claim::Unguarded));
    }
}
