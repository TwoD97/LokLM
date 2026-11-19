//! Original LokLM Markdown citation visibility rules. These identify supplied
//! passages, never entailment. Internal masks use UTF-8 bytes; public spans use
//! original UTF-16 offsets. Callers retain their existing answer-size budgets.
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

macro_rules! rx {
    ($pattern:expr) => {{
        static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        RE.get_or_init(|| {
            // ECMAScript whitespace and decimal digits, including inside nested
            // character classes. Rust's Unicode \s also includes U+0085 and
            // excludes BOM, and its default \d is broader than JavaScript's.
            Regex::new(&$pattern.replace(r"\s", r"[\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]")
                .replace(r"\S", r"[^\t\n\x0b\x0c\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]")
                .replace(r"\d", "[0-9]")).expect("fixed citation regex")
        })
    }};
}
pub(crate) fn ws(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn escaped(text: &str, at: usize) -> bool {
    text.as_bytes()[..at]
        .iter()
        .rev()
        .take_while(|&&c| c == b'\\')
        .count()
        % 2
        == 1
}
fn label(text: &str) -> String {
    rx!(r"\s+")
        .replace_all(text, " ")
        .trim_matches(ws)
        .to_lowercase()
}
fn destination_end(bytes: &[u8], mut end: usize) -> Option<usize> {
    let mut depth = 1;
    while end < bytes.len() && depth > 0 {
        match bytes[end] {
            b'\\' => end += 1,
            b'(' => depth += 1,
            b')' => depth -= 1,
            _ => {}
        }
        end += 1;
    }
    (depth == 0).then_some(end)
}

fn literal_mask(text: &str, html_tags: bool) -> Vec<bool> {
    let bytes = text.as_bytes();
    let mut mask = vec![false; bytes.len()];
    let mut fence: Option<(u8, usize)> = None;
    let mut list_indents = Vec::<usize>::new();
    let mut quote_depth = 0;
    let mut start = 0;
    for line in text.split_inclusive('\n') {
        let quote = rx!(r"^(?: {0,3}>[ \t]?)+")
            .find(line)
            .map_or("", |m| m.as_str());
        let depth = quote.bytes().filter(|&b| b == b'>').count();
        if depth != quote_depth {
            list_indents.clear();
        }
        quote_depth = depth;
        let raw = &line[quote.len()..];
        let leading = raw.bytes().take_while(|&b| b == b' ' || b == b'\t').count();
        let columns = raw[..leading]
            .bytes()
            .fold(0, |n, b| n + if b == b'\t' { 4 - n % 4 } else { 1 });
        let mut content = " ".repeat(columns) + &raw[leading..];
        if !content.trim_matches(ws).is_empty() && fence.is_none() {
            while list_indents.last().is_some_and(|&n| columns < n) {
                list_indents.pop();
            }
        }
        let container = list_indents.last().copied().unwrap_or(0);
        if columns >= container {
            content = content[container..].to_owned();
        }
        if fence.is_none()
            && let Some(item) =
                rx!(r"^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+|\r?\n?$)").captures(&content)
        {
            let matched = item.get(0).unwrap();
            // The original zero-width EOL alternative does not consume CR/LF.
            let padding_text = &item[2];
            let marker_width = matched.len() - padding_text.len();
            let padding = padding_text
                .bytes()
                .take_while(|b| matches!(b, b' ' | b'\t'))
                .fold(0, |n, b| {
                    n + if b == b'\t' {
                        4 - (container + marker_width + n) % 4
                    } else {
                        1
                    }
                });
            let consumed = if padding > 4 { 1 } else { padding.max(1) };
            list_indents.push(container + marker_width + consumed);
            let end = matched.end() - padding_text.len()
                + padding_text
                    .bytes()
                    .take_while(|b| matches!(b, b' ' | b'\t'))
                    .count();
            content = " ".repeat(padding.saturating_sub(consumed)) + &content[end..];
        }
        let run = rx!(r"^ {0,3}(`{3,}|~{3,}|\${2,})([^\n]*)").captures(&content);
        if let Some((character, length)) = fence {
            mask[start..start + line.len()].fill(true);
            if run.as_ref().is_some_and(|r| {
                r[1].as_bytes()[0] == character
                    && r[1].len() >= length
                    && rx!(r"^[ \t\r]*$").is_match(&r[2])
            }) {
                fence = None;
            }
        } else if let Some(run) = run.as_ref().filter(|r| {
            !(r[1].starts_with('`') && r[2].contains('`')
                || r[1].starts_with('$') && r[2].contains('$'))
        }) {
            fence = Some((run[1].as_bytes()[0], run[1].len()));
            mask[start..start + line.len()].fill(true);
        } else if rx!(r"^(?: {4}| {0,3}\t)").is_match(&content) {
            mask[start..start + line.len()].fill(true);
        }
        start += line.len();
    }
    for (at, _) in text.match_indices("](") {
        if !mask[at]
            && let Some(end) = destination_end(bytes, at + 2)
        {
            mask[at + 1..end].fill(true);
        }
    }
    for token in rx!(r#"<(?:[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*|[^\s<>]+@[^\s<>]+|/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*/?)>"#).find_iter(text) {
        if html_tags || rx!(r"^<(?:[A-Za-z][A-Za-z0-9+.-]*:|[^\s<>]+@)").is_match(token.as_str()) { mask[token.range()].fill(true); }
    }
    for url in rx!(r"(?-u:\b)[A-Za-z][A-Za-z0-9+.-]*://\S+").find_iter(text) {
        mask[url.range()].fill(true);
    }
    let runs: Vec<_> = rx!(r"`+")
        .find_iter(text)
        .filter(|m| !mask[m.start()])
        .collect();
    let mut by_length = HashMap::new();
    let mut next = vec![None; runs.len()];
    for (i, run) in runs.iter().enumerate().rev() {
        next[i] = by_length.insert(run.len(), i);
    }
    let mut i = 0;
    while i < runs.len() {
        let opening = runs[i];
        if !mask[opening.start()]
            && !escaped(text, opening.start())
            && let Some(closing) = next[i]
            && !rx!(r"\n[ \t\r]*\n").is_match(&text[opening.start()..runs[closing].start()])
        {
            mask[opening.start()..runs[closing].end()].fill(true);
            i = closing;
        }
        i += 1;
    }
    for comment in rx!(r"(?s)<!--.*?(?:-->|$)").find_iter(text) {
        if !mask[comment.start()] {
            mask[comment.range()].fill(true);
        }
    }
    let mut labels = HashSet::new();
    // JS multiline anchors also recognize standalone CR, LS and PS. The line
    // body deliberately still excludes only LF, as in the original scanner.
    for definition in
        rx!(r"(?m)(?:^|[\r\u{2028}\u{2029}])( {0,3}\[([^\]\n]+)\]:[^\n]*)").captures_iter(text)
    {
        let m = definition.get(1).unwrap();
        if !mask[m.start()] {
            labels.insert(label(&definition[2]));
            mask[m.range()].fill(true);
        }
    }
    let mut brackets = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if mask[i] {
            i += 1;
            continue;
        }
        if bytes[i] == b'\\' {
            if bytes.get(i + 1) == Some(&b'[') {
                mask[i + 1] = true;
            }
            i += 2;
            continue;
        }
        if bytes[i] == b'[' {
            brackets.push(i);
        } else if bytes[i] == b']'
            && let Some(start) = brackets.pop()
        {
            if labels.contains(&label(&text[start + 1..i])) {
                mask[start..i + 1].fill(true);
            }
            let mut after = i + 1;
            while after < bytes.len()
                && matches!(bytes[after], b' ' | b'\t' | b'\r' | b'\n')
                && after - i <= 256
            {
                after += 1;
            }
            let gap = text[i + 1..after].replace("\r\n", "\n").replace('\r', "\n");
            let separate = rx!(r"\n[ \t]*\n").is_match(&gap);
            let line_start = text[..start].rfind('\n').map_or(0, |n| n + 1);
            if bytes.get(after) == Some(&b':')
                && rx!(r"^ {0,3}$").is_match(&text[line_start..start])
            {
                let end = text[after..].find('\n').map_or(bytes.len(), |n| after + n);
                mask[start..end].fill(true);
            } else if bytes.get(i + 1) == Some(&b'(') {
                if let Some(end) = destination_end(bytes, i + 2) {
                    mask[start..end].fill(true);
                }
            } else if !separate
                && bytes.get(after) == Some(&b'[')
                && !rx!(r"^\[doc:\s*\d+\s*,\s*chunk:").is_match(&text[after..])
                && let Some(end) = text[after + 1..].find(']').map(|n| after + 1 + n)
                && text[after..end].encode_utf16().count() < 1000
            {
                mask[start..end + 1].fill(true);
            }
        }
        i += 1;
    }
    mask
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationMarker {
    pub document_id: u64,
    pub chunk_id: u64,
}
impl CitationMarker {
    pub fn key(self) -> String {
        format!("{}-{}", self.document_id, self.chunk_id)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CitationMatch {
    #[serde(flatten)]
    pub marker: CitationMarker,
    pub start: usize,
    pub end: usize,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationAttempt {
    #[serde(serialize_with = "serialize_js_number")]
    pub document_id: f64,
    #[serde(serialize_with = "serialize_js_number")]
    pub chunk_id: f64,
    pub start: usize,
    pub end: usize,
}
fn serialize_js_number<S: serde::Serializer>(n: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if n.is_finite() && *n >= 0.0 && *n < u64::MAX as f64 && n.fract() == 0.0 {
        serializer.serialize_u64(*n as u64)
    } else {
        serializer.serialize_f64(*n)
    }
}
fn valid(n: f64) -> bool {
    n > 0.0 && n <= 9_007_199_254_740_991.0 && n.fract() == 0.0
}
struct RawMatch {
    document: f64,
    chunk: f64,
    start: usize,
    end: usize,
}
impl RawMatch {
    fn marker(&self) -> Option<CitationMarker> {
        (valid(self.document) && valid(self.chunk)).then_some(CitationMarker {
            document_id: self.document as u64,
            chunk_id: self.chunk as u64,
        })
    }
}
fn raw_matches(text: &str) -> Vec<RawMatch> {
    let mask = literal_mask(text, true);
    rx!(r"\[doc:\s*(\d+)\s*,\s*chunk:\s*(\d+)\s*\]")
        .captures_iter(text)
        .filter_map(|c| {
            let m = c.get(0).unwrap();
            (!mask[m.start()]).then(|| RawMatch {
                document: c[1].parse().unwrap_or(f64::INFINITY),
                chunk: c[2].parse().unwrap_or(f64::INFINITY),
                start: m.start(),
                end: m.end(),
            })
        })
        .collect()
}
pub fn find_citation_attempts(text: &str) -> Vec<CitationAttempt> {
    raw_matches(text)
        .iter()
        .map(|m| CitationAttempt {
            document_id: m.document,
            chunk_id: m.chunk,
            start: text[..m.start].encode_utf16().count(),
            end: text[..m.end].encode_utf16().count(),
        })
        .collect()
}
pub fn find_citation_matches(text: &str) -> Vec<CitationMatch> {
    raw_matches(text)
        .iter()
        .filter_map(|m| {
            m.marker().map(|marker| CitationMatch {
                marker,
                start: text[..m.start].encode_utf16().count(),
                end: text[..m.end].encode_utf16().count(),
            })
        })
        .collect()
}
pub fn extract_citation_markers(text: &str) -> Vec<CitationMarker> {
    raw_matches(text)
        .iter()
        .filter_map(RawMatch::marker)
        .collect()
}
pub fn has_unmasked_citation_syntax(text: &str) -> bool {
    let mask = literal_mask(text, true);
    rx!(r"(?i)\[doc\s*:")
        .find_iter(text)
        .any(|m| !mask[m.start()])
}
pub fn has_active_html_syntax(text: &str) -> bool {
    let mask = literal_mask(text, false);
    // The second alternative's lookahead is checked explicitly (linear regex).
    rx!(r"(?i)<(?:/?[A-Za-z][^<>]*>|/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul|pre|script|style|textarea)(?:[\s/>]|$)|[!?])").find_iter(text).any(|m| !mask[m.start()] && !escaped(text, m.start()))
}
pub fn strip_citation_markers(text: &str) -> String {
    let mut out = String::new();
    let mut cursor = 0;
    for m in raw_matches(text).iter().filter(|m| m.marker().is_some()) {
        out.push_str(&text[cursor..m.start]);
        cursor = m.end;
    }
    out.push_str(&text[cursor..]);
    out
}
pub fn reconcile_citations<T: Clone>(
    text: &str,
    fed: &[T],
    key_of: impl Fn(&T) -> String,
) -> Vec<T> {
    let matches = raw_matches(text);
    // JS Map preserves first key position, last value on duplicate keys.
    let mut ordered = Vec::<(String, T)>::new();
    for item in fed {
        let key = key_of(item);
        if let Some((_, value)) = ordered.iter_mut().find(|(k, _)| *k == key) {
            *value = item.clone();
        } else {
            ordered.push((key, item.clone()));
        }
    }
    if matches.is_empty() {
        return ordered.into_iter().map(|(_, v)| v).collect();
    }
    let mut seen = HashSet::new();
    matches
        .iter()
        .filter_map(|m| m.marker())
        .filter_map(|m| {
            let key = m.key();
            let item = ordered.iter().find(|(k, _)| *k == key)?;
            seen.insert(key).then(|| item.1.clone())
        })
        .collect()
}
pub fn has_cited_sources(text: &str, allowed: &HashSet<String>) -> bool {
    extract_citation_markers(text)
        .iter()
        .any(|m| allowed.contains(&m.key()))
}
#[derive(Debug, Serialize)]
pub struct IndexedMarker {
    #[serde(flatten)]
    pub marker: CitationMarker,
    pub index: usize,
}
#[derive(Debug, Serialize)]
pub struct TransformedCitations {
    pub text: String,
    pub markers: Vec<IndexedMarker>,
}
pub fn transform_citation_markers(text: &str, allowed: &HashSet<String>) -> TransformedCitations {
    let mut result = TransformedCitations {
        text: String::new(),
        markers: Vec::new(),
    };
    let mut cursor = 0;
    for m in raw_matches(text) {
        let Some(marker) = m.marker().filter(|m| allowed.contains(&m.key())) else {
            continue;
        };
        let index = result
            .markers
            .iter()
            .position(|m| m.marker == marker)
            .map_or_else(
                || {
                    let index = result.markers.len() + 1;
                    result.markers.push(IndexedMarker { marker, index });
                    index
                },
                |i| i + 1,
            );
        result.text.push_str(&text[cursor..m.start]);
        result
            .text
            .push_str(&format!("[{index}](#cite-{})", marker.key()));
        cursor = m.end;
    }
    result.text.push_str(&text[cursor..]);
    result
}
pub fn parse_cite_href(href: Option<&str>) -> Option<CitationMarker> {
    let c = rx!(r"^#cite-(\d+)-(\d+)\z").captures(href?)?;
    let document: f64 = c[1].parse().ok()?;
    let chunk: f64 = c[2].parse().ok()?;
    (valid(document) && valid(chunk)).then_some(CitationMarker {
        document_id: document as u64,
        chunk_id: chunk as u64,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SourceLabelRejection {
    #[serde(rename = "source_label_malformed")]
    Malformed,
    #[serde(rename = "source_label_unattached")]
    Unattached,
    #[serde(rename = "source_label_ambiguous")]
    Ambiguous,
    #[serde(rename = "source_label_literal_overlap")]
    LiteralOverlap,
    #[serde(rename = "source_label_placement")]
    Placement,
}
fn letter_number(c: Option<char>) -> bool {
    // Original non-u indexing passes one UTF-16 code unit to the Unicode test.
    c.is_some_and(|c| c.len_utf16() == 1 && rx!(r"^[\p{L}\p{N}]$").is_match(&c.to_string()))
}
fn horizontal(c: Option<char>) -> bool {
    c.is_some_and(|c| c == '\t' || rx!(r"^\p{Zs}$").is_match(&c.to_string()))
}
fn boundary(c: Option<char>) -> bool {
    c.is_none_or(|c| ws(c) || ".,;:!?".contains(c))
}
pub fn remove_redundant_source_labels(
    text: &str,
    sources: &HashSet<String>,
) -> Result<String, SourceLabelRejection> {
    if !rx!(r"(?i)\([ \t]*doc[ \t]*:").is_match(text) {
        return Ok(text.to_owned());
    }
    let mut mask = literal_mask(text, true);
    let mut ambiguous = false;
    let mut quoted = false;
    let mut start = 0;
    for line in text.split_inclusive('\n') {
        let quote = rx!(r"^(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+)*[ \t]*>[ \t]?").find(line);
        let interruption = rx!(r"^[ \t]*(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[-+*][ \t]+|1[.)][ \t]+|(?:[-*_][ \t]*){3,}$|<)").is_match(line.trim_end_matches(ws));
        if let Some(quote) = quote {
            mask[start..start + line.len()].fill(true);
            quoted = !line[quote.end()..]
                .trim_start_matches([' ', '\t', '>'])
                .trim_matches(ws)
                .is_empty();
        } else if line.trim_matches(ws).is_empty() || interruption {
            quoted = false;
        } else if quoted {
            mask[start..start + line.len()].fill(true);
        }
        start += line.len();
    }
    // Backreference and lookaheads of the original bounded inline-math pattern.
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'$' {
            i += 1;
            continue;
        }
        let len = b[i..].iter().take_while(|&&c| c == b'$').count().min(2);
        if b.get(i + len) == Some(&b'$') {
            i += 1;
            continue;
        }
        let body = if len == 2 {
            rx!(r"^(?:\\[^\r\n\u{2028}\u{2029}]|[^$\n])*?(\$\$)(?:[^$]|$)")
        } else {
            rx!(r"^(?:\\[^\r\n\u{2028}\u{2029}]|[^$\n])*?(\$)(?:[^$]|$)")
        };
        let matched = body
            .captures(&text[i + len..])
            .map(|m| i + len + m.get(1).unwrap().end());
        if let Some(end) = matched {
            if !escaped(text, i) {
                mask[i..end].fill(true);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    let mut chars = text.char_indices().peekable();
    while let Some((start, opening)) = chars.next() {
        let closers = match opening {
            '"' => "\"",
            '\'' => "'",
            '“' => "”",
            '„' => "“”",
            '‘' => "’",
            '«' => "»",
            '‹' => "›",
            '»' => "«",
            '›' => "‹",
            _ => continue,
        };
        if mask[start]
            || escaped(text, start)
            || (matches!(opening, '\'' | '"') && letter_number(text[..start].chars().next_back()))
        {
            continue;
        }
        let mut closing = None;
        for (end, c) in chars.by_ref() {
            // Original checks only the next sixteen UTF-16 units for a blank paragraph.
            let tail: String = text[end..]
                .chars()
                .scan(0, |n, c| {
                    *n += c.len_utf16();
                    (*n <= 16).then_some(c)
                })
                .collect();
            if rx!(r"^\r?\n[ \t]*\r?\n").is_match(&tail) {
                break;
            }
            let embedded = matches!(opening, '\'' | '"')
                && letter_number(text[end + c.len_utf8()..].chars().next());
            if closers.contains(c) && !(mask[end] || escaped(text, end) || embedded) {
                closing = Some(end + c.len_utf8());
                break;
            }
        }
        if let Some(end) = closing {
            mask[start..end].fill(true);
        } else {
            ambiguous = true;
        }
    }
    let mut removals = Vec::new();
    for candidate in rx!(r"(?i)\([ \t]*doc[ \t]*:").find_iter(text) {
        let start = candidate.start();
        if mask[start] || escaped(text, start) {
            continue;
        }
        if ambiguous {
            return Err(SourceLabelRejection::Ambiguous);
        }
        let end = text[start..]
            .find(')')
            .map(|n| start + n + 1)
            .ok_or(SourceLabelRejection::Malformed)?;
        if text[start..end].contains(['\r', '\n']) {
            return Err(SourceLabelRejection::Malformed);
        }
        let c = rx!(r"(?i)^\([ \t]*doc[ \t]*:[ \t]*([1-9]\d*)[ \t]*(?::|,[ \t]*chunk[ \t]*:)[ \t]*([1-9]\d*)[ \t]*\)$").captures(&text[start..end]).ok_or(SourceLabelRejection::Malformed)?;
        if !valid(c[1].parse().unwrap_or(f64::INFINITY))
            || !valid(c[2].parse().unwrap_or(f64::INFINITY))
        {
            return Err(SourceLabelRejection::Malformed);
        }
        if !sources.contains(&format!("{}:{}", &c[1], &c[2])) {
            return Err(SourceLabelRejection::Unattached);
        }
        let before = text[..start].chars().next_back();
        let after = text[end..].chars().next();
        if !boundary(before) || !boundary(after) {
            return Err(SourceLabelRejection::Placement);
        }
        if mask[start..end].iter().any(|&m| m) {
            return Err(SourceLabelRejection::LiteralOverlap);
        }
        let mut remove_start = start;
        let mut remove_end = end;
        let after_spaces = end
            + text[end..]
                .chars()
                .take_while(|&c| horizontal(Some(c)))
                .map(char::len_utf8)
                .sum::<usize>();
        let trim_before = horizontal(before)
            && (text[after_spaces..].starts_with(['\r', '\n'])
                || after.is_none_or(|c| ".,;:!?".contains(c)));
        if trim_before {
            while horizontal(text[..remove_start].chars().next_back()) {
                remove_start -= text[..remove_start].chars().next_back().unwrap().len_utf8();
            }
        } else if (horizontal(before) || start == 0) && horizontal(after) {
            remove_end = after_spaces;
        }
        removals.push((remove_start, remove_end));
    }
    let mut out = String::new();
    let mut cursor = 0;
    for (start, end) in removals {
        out.push_str(&text[cursor..cursor.max(start)]);
        cursor = cursor.max(end);
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}
