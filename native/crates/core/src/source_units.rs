//! Complete immutable source units, ported from qa/sourceUnits.ts. Sentence
//! boundaries are display boundaries, never relevance/entailment certification.
use icu_segmenter::{SentenceSegmenter, options::SentenceBreakOptions};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};
pub const SEGMENTATION_VERSION: &str = "loklm-0.7.4-icu4x-2.4.0-en-v1";
const SPACE: &str = r"[\x09-\x0d\x20\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";
macro_rules! rx {
    ($p:literal) => {{
        static RX: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(&$p.replace(r"\s", SPACE)).expect("fixed source unit pattern")
        });
        &*RX
    }};
}
fn space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn trim(s: &str) -> &str {
    s.trim_matches(space)
}
fn utf16(s: &str) -> usize {
    s.encode_utf16().count()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitPassage {
    pub document_id: i64,
    pub chunk_id: i64,
    pub text: String,
    #[serde(default)]
    pub document_title: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceUnit {
    pub id: String,
    pub source: String,
    pub start: usize,
    pub end: usize,
    pub text: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CatalogFailure {
    SourceBounds,
    UnitBounds,
    Segmentation,
}
pub struct SourceUnitCatalog {
    units: Vec<SourceUnit>,
    annotated: HashMap<String, String>,
}
impl SourceUnitCatalog {
    pub fn units(&self) -> &[SourceUnit] {
        &self.units
    }
    pub fn get(&self, id: &str) -> Option<&SourceUnit> {
        self.units.iter().find(|u| u.id == id)
    }
    pub fn prompt_source_text(&self, document_id: i64, chunk_id: i64) -> Option<&str> {
        self.annotated
            .get(&format!("{document_id}:{chunk_id}"))
            .map(String::as_str)
    }
}
struct Line<'a> {
    start: usize,
    end: usize,
    text: &'a str,
}
struct Block {
    start: usize,
    end: usize,
    structured: bool,
}
fn fence(line: &str) -> Option<&str> {
    rx!(r"^ {0,3}(`{3,}|~{3,})")
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
}
fn structured(text: &str) -> bool {
    rx!(r"(?:^|[\r\n\u{2028}\u{2029}])(?: {0,3}(?:#{1,6}(?:\s|$)|>|[-+*]\s|[0-9]+[.)]\s|(?:`{3,}|~{3,})|\|)| {4}|\t)").is_match(text)
        ||text.contains('|')||text.contains('<')||text.contains("$$")
}
fn abbreviation(text: &str) -> bool {
    rx!(r"(?-u:\b)(?:Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|vs|etc|e\.g|i\.e|z\.\s*B|d\.\s*h)\.|(?:^|\s)\p{Lu}\.(?:\s|$)").is_match(text)
}
fn blocks(text: &str) -> Vec<Block> {
    let lines = rx!(r"[^\r\n]*(?:\r\n|\r|\n|$)")
        .find_iter(text)
        .filter(|m| !m.is_empty())
        .map(|m| Line {
            start: m.start(),
            end: m.end(),
            text: m.as_str(),
        })
        .collect::<Vec<_>>();
    let mut result = vec![];
    let mut index = 0;
    while index < lines.len() {
        if trim(lines[index].text).is_empty() {
            index += 1;
            continue;
        }
        let first = index;
        let mut open = None::<(u8, usize)>;
        let mut block_structured = false;
        while index < lines.len() {
            let line = &lines[index];
            if let Some(run) = fence(line.text) {
                block_structured = true;
                match open {
                    None => open = Some((run.as_bytes()[0], run.len())),
                    Some((character, length))
                        if run.as_bytes()[0] == character && run.len() >= length =>
                    {
                        let start = line.text.find(run).unwrap();
                        if trim(&line.text[start + run.len()..]).is_empty() {
                            open = None;
                        }
                    }
                    _ => {}
                }
            }
            if open.is_none() && trim(line.text).is_empty() {
                let mut next = index + 1;
                while next < lines.len() && trim(lines[next].text).is_empty() {
                    next += 1;
                }
                let container = rx!(r"^(?: {0,3}(?:>|[-+*]\s|[0-9]+[.)]\s)| {4}|\t)")
                    .is_match(lines[first].text);
                if container
                    && next < lines.len()
                    && rx!(r"^(?:\s|>|[-+*]\s|[0-9]+[.)]\s)").is_match(lines[next].text)
                {
                    index = next;
                    continue;
                }
                break;
            }
            index += 1;
        }
        let start = lines[first].start;
        let end = lines[index - 1].end;
        result.push(Block {
            start,
            end,
            structured: block_structured || structured(&text[start..end]),
        });
    }
    result
}
thread_local! {static SEGMENTER: SentenceSegmenter = {
    let language = "en".parse().expect("fixed English locale");
    let mut options = SentenceBreakOptions::default();
    options.content_locale = Some(&language);
    SentenceSegmenter::try_new(options).expect("pinned compiled English sentence data")
};}
/// Owns immutable copies of all units and labelled text. Adding labels preserves
/// every original byte, including qualifiers and whitespace between units.
pub fn create(input: &[UnitPassage]) -> Result<SourceUnitCatalog, CatalogFailure> {
    if input.is_empty() || input.len() > 32 {
        return Err(CatalogFailure::SourceBounds);
    }
    let mut total = 0;
    let mut ids = HashSet::new();
    for passage in input {
        if !(1..=9_007_199_254_740_991).contains(&passage.document_id)
            || !(1..=9_007_199_254_740_991).contains(&passage.chunk_id)
            || !ids.insert((passage.document_id, passage.chunk_id))
            || trim(&passage.text).is_empty()
            || utf16(&passage.text) > 64_000
        {
            return Err(CatalogFailure::SourceBounds);
        }
        total += utf16(&passage.text);
        if total > 256_000 {
            return Err(CatalogFailure::SourceBounds);
        }
    }
    let mut catalog = SourceUnitCatalog {
        units: vec![],
        annotated: HashMap::new(),
    };
    for passage in input {
        let text = &passage.text;
        let source = format!("{}:{}", passage.document_id, passage.chunk_id);
        let code=rx!(r"(?i)\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|c|cc|cpp|h|cs|sh|ps1|sql|json|ya?ml|toml|xml|html|css)$").is_match(passage.document_title.as_deref().unwrap_or(""));
        let source_blocks = if code {
            vec![Block {
                start: 0,
                end: text.len(),
                structured: true,
            }]
        } else {
            blocks(text)
        };
        let mut ranges = vec![];
        for block in source_blocks {
            let part = &text[block.start..block.end];
            if block.structured || abbreviation(part) {
                ranges.push((block.start, block.end));
            } else {
                let boundaries =
                    SEGMENTER.with(|s| s.as_borrowed().segment_str(part).collect::<Vec<_>>());
                for bounds in boundaries.windows(2) {
                    let raw = &part[bounds[0]..bounds[1]];
                    let start =
                        block.start + bounds[0] + raw.len() - raw.trim_start_matches(space).len();
                    let end =
                        block.start + bounds[1] - (raw.len() - raw.trim_end_matches(space).len());
                    if start < end {
                        ranges.push((start, end));
                    }
                }
            }
        }
        let mut cursor = 0;
        let mut labelled = String::new();
        for (start, end) in ranges {
            if catalog.units.len() >= 256 {
                return Err(CatalogFailure::UnitBounds);
            }
            if start < cursor || !trim(&text[cursor..start]).is_empty() {
                return Err(CatalogFailure::Segmentation);
            }
            let id = format!("U{}", catalog.units.len() + 1);
            labelled.push_str(&text[cursor..start]);
            labelled.push_str(&format!("[{id}] "));
            labelled.push_str(&text[start..end]);
            cursor = end;
            catalog.units.push(SourceUnit {
                id,
                source: source.clone(),
                start: utf16(&text[..start]),
                end: utf16(&text[..end]),
                text: text[start..end].into(),
            });
        }
        if !trim(&text[cursor..]).is_empty() {
            return Err(CatalogFailure::Segmentation);
        }
        labelled.push_str(&text[cursor..]);
        catalog.annotated.insert(source, labelled);
    }
    if catalog.units.is_empty() {
        return Err(CatalogFailure::Segmentation);
    }
    Ok(catalog)
}
