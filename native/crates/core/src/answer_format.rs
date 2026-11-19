//! Exact source escaping and conservative final EN/DE format eligibility.
//! Neither function interprets source instructions or verifies an answer.
use crate::citation_markers::ws;
use regex::Regex;
use std::sync::LazyLock;
pub fn requests_single_sentence(question: &str) -> bool {
    if question.chars().any(|c| "`'\"<>$“”„‟‘’‚‛«»‹›".contains(c)) || question.contains("~~~")
    {
        return false;
    }
    let trimmed = question.trim_end_matches(ws);
    let last_line = trimmed.rsplit('\n').next().unwrap_or("");
    if last_line.starts_with("    ") || last_line.starts_with('\t') {
        return false;
    }
    static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:^|[.!?][ \t\r\n]+)(?:(?:please[ \t]+)?(?:answer|respond|reply)[ \t]+in[ \t]+(?:one|a[ \t]+single)[ \t]+(?:short[ \t]+)?sentence|(?:bitte[ \t]+)?(?:antworte|beantworte[ \t]+(?:die|diese)[ \t]+frage)[ \t]+in[ \t]+einem[ \t]+(?:kurzen[ \t]+)?satz)[.!]?[ \t]*$").unwrap()
    });
    PATTERN.is_match(trimmed)
}
pub fn escape_source_markdown(text: &str) -> String {
    let mut escaped = String::new();
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            _ => {
                if r"\`*_[]{}()#!|~+-.$:@".contains(c) {
                    escaped.push('\\');
                }
                escaped.push(c);
            }
        }
    }
    escaped
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| {
            let mut out = String::new();
            let mut leading = true;
            for c in line.chars() {
                if leading && matches!(c, ' ' | '\t') {
                    out.push_str(if c == '\t' { "&#9;" } else { "&#32;" });
                } else {
                    leading = false;
                    out.push(c);
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn source_quote_markdown(text: &str) -> String {
    escape_source_markdown(text)
        .split('\n')
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
