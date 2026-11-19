//! Port of documents/chunker.ts and markdownParser.ts at 4651557.
//! Budgets use Unicode scalar values instead of JS UTF-16 code units; version
//! this change so existing indexes are never silently mixed with fresh chunks.
use serde::{Deserialize, Serialize};
pub const CHUNKER_VERSION: &str = "loklm-rust-scalar-v1";
const MAX: usize = 2000;
const OVERLAP: usize = 200;
const SEPARATORS: [&str; 9] = ["\n\n\n", "\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DocumentChunk {
    pub ordinal: usize,
    pub text: String,
    pub page_from: Option<u32>,
    pub page_to: Option<u32>,
    pub heading_path: Option<Vec<String>>,
}
#[derive(Clone, Debug)]
pub struct MarkdownSection {
    pub heading_path: Vec<String>,
    pub text: String,
}

pub fn chunk_pages(pages: &[(u32, String)]) -> Vec<DocumentChunk> {
    let mut result = vec![];
    for (page, text) in pages {
        for piece in overlap(split(text, MAX, 0), MAX) {
            if !piece.trim().is_empty() {
                result.push(DocumentChunk {
                    ordinal: result.len(),
                    text: piece.trim().into(),
                    page_from: Some(*page),
                    page_to: Some(*page),
                    heading_path: None,
                });
            }
        }
    }
    result
}
fn len(s: &str) -> usize {
    s.chars().count()
}
fn split(s: &str, max: usize, sep_index: usize) -> Vec<String> {
    if len(s) <= max {
        return vec![s.into()];
    }
    if sep_index == SEPARATORS.len() {
        return s
            .chars()
            .collect::<Vec<_>>()
            .chunks(max)
            .map(|c| c.iter().collect())
            .collect();
    }
    let sep = SEPARATORS[sep_index];
    let parts = s.split(sep).collect::<Vec<_>>();
    if parts.len() == 1 {
        return split(s, max, sep_index + 1);
    }
    let parts = parts
        .iter()
        .flat_map(|p| split(p, max, sep_index + 1))
        .collect::<Vec<_>>();
    let mut out = vec![];
    let mut buf = String::new();
    for p in parts {
        let candidate = if buf.is_empty() {
            p.clone()
        } else {
            format!("{buf}{sep}{p}")
        };
        if len(&candidate) <= max {
            buf = candidate
        } else {
            if !buf.is_empty() {
                out.push(buf)
            };
            buf = p;
        }
    }
    if !buf.is_empty() {
        out.push(buf)
    }
    out
}
fn overlap(pieces: Vec<String>, max: usize) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for mut p in pieces {
        if let Some(prev) = out.last() {
            let tail = prev
                .chars()
                .skip(len(prev).saturating_sub(OVERLAP))
                .collect::<String>();
            let sep = if tail.ends_with(' ') { "" } else { " " };
            if len(&p) + len(&tail) + sep.len() <= max {
                p = format!("{tail}{sep}{p}");
            }
        }
        out.push(p);
    }
    out
}
fn fence(line: &str) -> Option<(char, usize, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let c = trimmed.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = trimmed.chars().take_while(|x| *x == c).count();
    if n < 3 {
        None
    } else {
        Some((c, n, &trimmed[n..]))
    }
}
pub fn parse_markdown(raw: &str) -> Vec<MarkdownSection> {
    let normalized = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let text = if let Some(rest) = normalized.strip_prefix("---\n") {
        rest.find("\n---\n")
            .map(|i| &rest[i + 5..])
            .unwrap_or(&normalized)
    } else {
        &normalized
    };
    let lines = text.lines().collect::<Vec<_>>();
    let mut out = vec![];
    let mut stack: Vec<(usize, String)> = vec![];
    let mut body = vec![];
    let mut active: Option<(char, usize)> = None;
    let mut i = 0;
    let flush =
        |out: &mut Vec<MarkdownSection>, body: &mut Vec<&str>, stack: &[(usize, String)]| {
            let text = body.join("\n").trim().to_string();
            body.clear();
            if !text.is_empty() {
                out.push(MarkdownSection {
                    heading_path: stack.iter().map(|(_, s)| s.clone()).collect(),
                    text,
                });
            }
        };
    while i < lines.len() {
        let line = lines[i];
        if let Some((c, n, tail)) = fence(line) {
            if let Some((open, count)) = active {
                if c == open && n >= count && tail.trim().is_empty() {
                    active = None;
                }
            } else if c != '`' || !tail.contains('`') {
                active = Some((c, n));
            }
            body.push(line);
            i += 1;
            continue;
        }
        if active.is_some() {
            body.push(line);
            i += 1;
            continue;
        }
        let n = line.chars().take_while(|c| *c == '#').count();
        let mut heading = None;
        if (1..=6).contains(&n) && line[n..].starts_with([' ', '\t']) {
            let title = line[n..].trim();
            let stripped = title.trim_end_matches('#');
            let title = if stripped.ends_with([' ', '\t']) {
                stripped.trim()
            } else {
                title
            };
            heading = Some((n, title.to_string()));
        } else if !line.trim().is_empty() && i + 1 < lines.len() {
            let next = lines[i + 1].trim_end();
            if !next.is_empty() && next.chars().all(|c| c == '=') {
                heading = Some((1, line.trim().into()));
                i += 1;
            } else if next.len() >= 3 && next.chars().all(|c| c == '-') {
                heading = Some((2, line.trim().into()));
                i += 1;
            }
        }
        if let Some((level, title)) = heading {
            flush(&mut out, &mut body, &stack);
            while stack.last().is_some_and(|(n, _)| *n >= level) {
                stack.pop();
            }
            stack.push((level, title));
        } else {
            body.push(line);
        }
        i += 1;
    }
    flush(&mut out, &mut body, &stack);
    out
}
pub fn chunk_markdown(raw: &str) -> Vec<DocumentChunk> {
    chunk_markdown_sections(&parse_markdown(raw))
}
pub fn chunk_markdown_sections(sections: &[MarkdownSection]) -> Vec<DocumentChunk> {
    let mut out = vec![];
    for section in sections {
        let prefix = section
            .heading_path
            .last()
            .filter(|s| len(s) + 4 <= MAX / 2)
            .map(|s| format!("# {s}\n\n"))
            .unwrap_or_default();
        let body = section.text.trim();
        if body.is_empty() {
            continue;
        }
        let full = format!("{prefix}{body}");
        let pieces = if len(&full) <= MAX {
            vec![full]
        } else {
            let mut pieces = split_markdown_body(body, MAX - len(&prefix));
            if let Some(first) = pieces.first_mut() {
                *first = format!("{prefix}{first}");
            }
            pieces
        };
        for text in pieces {
            out.push(DocumentChunk {
                ordinal: out.len(),
                text,
                page_from: None,
                page_to: None,
                heading_path: if section.heading_path.is_empty() {
                    None
                } else {
                    Some(section.heading_path.clone())
                },
            });
        }
    }
    out
}
fn cells(line: &str) -> Option<Vec<String>> {
    if line.starts_with("    ") || line.starts_with('\t') {
        return None;
    }
    let line = line.trim();
    let mut cells = vec![];
    let mut start = 0;
    let mut escaped = false;
    for (i, c) in line.char_indices() {
        if c == '|' && !escaped {
            cells.push(line[start..i].trim().to_string());
            start = i + 1;
        }
        escaped = c == '\\' && !escaped;
    }
    if cells.is_empty() {
        return None;
    }
    cells.push(line[start..].trim().into());
    if line.starts_with('|') {
        cells.remove(0);
    }
    if start == line.len() {
        cells.pop();
    }
    Some(cells)
}
fn split_markdown_body(body: &str, max: usize) -> Vec<String> {
    let lines = body.lines().collect::<Vec<_>>();
    let mut out = vec![];
    let mut prose = vec![];
    let mut active = None;
    let mut i = 0;
    let flush = |prose: &mut Vec<&str>, out: &mut Vec<String>| {
        let text = prose.join("\n");
        if !text.trim().is_empty() {
            out.extend(overlap(split(text.trim(), max, 0), max));
        }
        prose.clear();
    };
    while i < lines.len() {
        let line = lines[i];
        if let Some((c, n, tail)) = fence(line) {
            match active {
                None => active = Some((c, n)),
                Some((o, count)) if o == c && n >= count && tail.trim().is_empty() => active = None,
                _ => {}
            }
            prose.push(line);
            i += 1;
            continue;
        }
        let header = cells(line);
        let delim = lines.get(i + 1).and_then(|s| cells(s));
        let is_table = active.is_none()
            && header.as_ref().zip(delim.as_ref()).is_some_and(|(h, d)| {
                !h.is_empty()
                    && h.len() == d.len()
                    && d.iter().all(|s| {
                        let s = s.trim_matches(':');
                        s.len() >= 3 && s.chars().all(|c| c == '-')
                    })
            });
        if !is_table {
            prose.push(line);
            i += 1;
            continue;
        }
        flush(&mut prose, &mut out);
        let count = header.unwrap().len();
        let mut table = vec![line, lines[i + 1]];
        i += 2;
        while i < lines.len() && cells(lines[i]).is_some_and(|c| c.len() == count) {
            table.push(lines[i]);
            i += 1;
        }
        let head = table[..2].join("\n");
        if len(&head) > max || table[2..].iter().any(|r| len(&head) + 1 + len(r) > max) {
            out.extend(split(&table.join("\n"), max, 0));
            continue;
        }
        let mut fragment = head.clone();
        for row in &table[2..] {
            if len(&fragment) + 1 + len(row) > max {
                out.push(fragment);
                fragment = head.clone();
            }
            fragment.push('\n');
            fragment.push_str(row);
        }
        out.push(fragment);
    }
    flush(&mut prose, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn headings_code_and_unicode() {
        let chunks = chunk_markdown(
            "---\ntitle: ignored\n---\n# Über uns\nGrüne Energie.\n```sh\n# not a heading\n```\n## C#\nEnglish content.",
        );
        assert_eq!(chunks.len(), 2);
        assert_eq!(
            chunks[1].heading_path,
            Some(vec!["Über uns".into(), "C#".into()])
        );
        assert!(chunks[0].text.contains("# not a heading"));
        let chunks = chunk_pages(&[(1, "🦀".repeat(8000))]);
        assert!(chunks.iter().all(|c| len(&c.text) <= MAX));
    }
    #[test]
    fn long_table_repeats_header_without_losing_rows() {
        let rows = (0..250)
            .map(|i| format!("| {i} | Berlin |\n"))
            .collect::<String>();
        let chunks = chunk_markdown(&format!("# Data\n| ID | City |\n| --- | --- |\n{rows}"));
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.text.contains("| ID | City |")));
        for i in 0..250 {
            assert!(
                chunks
                    .iter()
                    .any(|c| c.text.contains(&format!("| {i} | Berlin |")))
            );
        }
    }
}
