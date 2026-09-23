//! The two attribute macros the shell uses, as pass-throughs.
//!
//! The real ones generate an invoke wrapper. For type-checking the BODY of a
//! command — which is where the shell has broken twice — passing the function
//! through unchanged is enough and needs no Tauri.
use proc_macro::TokenStream;

#[proc_macro_attribute]
pub fn command(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
