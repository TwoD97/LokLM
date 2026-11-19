//! Bounded OOXML text/heading/table import. Unsupported content is an explicit
//! whole-document error. No ZIP entry is ever extracted onto the filesystem.
use crate::{INPUT_LIMIT, OUTPUT_LIMIT};
use loklm_core::{Error, Result};
use quick_xml::{
    XmlVersion,
    events::{BytesStart, Event},
    name::ResolveResult,
    reader::NsReader,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read},
};

const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const STRICT_WORD: &str = "http://purl.oclc.org/ooxml/wordprocessingml/main";
const PART_LIMIT: usize = 8 * 1024 * 1024;
#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedDocx {
    pub markdown: String,
    pub sections: Vec<DocxSection>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct DocxSection {
    pub heading_path: Vec<String>,
    pub text: String,
}
fn flush_section(sections: &mut Vec<DocxSection>, body: &mut String, headings: &[(usize, String)]) {
    if body.trim().is_empty()
        && let Some((_, title)) = headings.last()
    {
        body.push_str(title);
    }
    if !body.trim().is_empty() {
        sections.push(DocxSection {
            heading_path: headings.iter().map(|(_, s)| s.clone()).collect(),
            text: std::mem::take(body),
        });
    }
}
fn invalid() -> Error {
    Error::Invalid("Malformed or over-budget DOCX".into())
}
fn unsupported() -> Error {
    Error::Unsupported("This DOCX contains content requiring the pending full importer (images, notes, fields, revisions, lists or embedded objects)".into())
}
fn word(ns: &ResolveResult<'_>) -> bool {
    matches!(ns, ResolveResult::Bound(n) if [WORD, STRICT_WORD].contains(&n.as_ref()))
}
fn attribute(element: &BytesStart<'_>, key: &str) -> Result<Option<String>> {
    let mut found = None;
    for attribute in element.attributes() {
        let a = attribute.map_err(|_| invalid())?;
        if a.key.local_name().as_ref() == key {
            if found.is_some() {
                return Err(invalid());
            }
            found = Some(
                a.normalized_value(XmlVersion::Implicit1_0)
                    .map_err(|_| invalid())?
                    .into_owned(),
            );
        }
    }
    Ok(found)
}
fn xml(bytes: &[u8]) -> Result<NsReader<&[u8]>> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        Error::Unsupported("DOCX XML encoding must be UTF-8 in this preview".into())
    })?;
    let mut reader = NsReader::from_str(text);
    reader.config_mut().expand_empty_elements = true;
    reader.resolver_mut().set_max_namespace_bindings(128);
    Ok(reader)
}
fn declaration(event: &quick_xml::events::BytesDecl<'_>) -> Result<()> {
    if let Some(encoding) = event.encoding() {
        let encoding = encoding.map_err(|_| invalid())?;
        if !encoding.eq_ignore_ascii_case("utf-8") {
            return Err(Error::Unsupported("DOCX XML encoding is not UTF-8".into()));
        }
    }
    Ok(())
}
#[derive(Default)]
struct Style {
    heading: Option<usize>,
    parent: Option<String>,
    numbered: bool,
}
#[derive(Default)]
struct StyleCatalog {
    headings: HashMap<String, usize>,
    numbered: HashSet<String>,
    default: Option<String>,
    defaults_numbered: bool,
}
fn numbering_styles(bytes: Option<&Vec<u8>>) -> Result<HashSet<String>> {
    let mut ids = HashSet::new();
    let Some(bytes) = bytes else {
        return Ok(ids);
    };
    let mut reader = xml(bytes)?;
    let mut depth = 0usize;
    loop {
        let (ns, event) = reader.read_resolved_event().map_err(|_| invalid())?;
        match event {
            Event::Start(e) => {
                depth += 1;
                if depth > 128 {
                    return Err(invalid());
                }
                if word(&ns)
                    && e.local_name().as_ref() == "pStyle"
                    && let Some(id) = attribute(&e, "val")?
                {
                    ids.insert(id);
                }
            }
            Event::End(_) => depth = depth.checked_sub(1).ok_or_else(invalid)?,
            Event::DocType(_) => return Err(invalid()),
            Event::Decl(e) => declaration(&e)?,
            Event::Eof => {
                if depth != 0 {
                    return Err(invalid());
                }
                break;
            }
            _ => {}
        }
    }
    Ok(ids)
}
fn styles(bytes: Option<&Vec<u8>>, numbering: Option<&Vec<u8>>) -> Result<StyleCatalog> {
    let mut catalog = StyleCatalog {
        numbered: numbering_styles(numbering)?,
        ..StyleCatalog::default()
    };
    let Some(bytes) = bytes else {
        return Ok(catalog);
    };
    let mut reader = xml(bytes)?;
    let mut definitions = HashMap::<String, Style>::new();
    let mut current: Option<(String, Style)> = None;
    let mut depth = 0usize;
    let mut defaults_depth = None;
    loop {
        let (ns, event) = reader.read_resolved_event().map_err(|_| invalid())?;
        match event {
            Event::Start(e) => {
                depth += 1;
                if depth > 128 {
                    return Err(invalid());
                }
                if !word(&ns) {
                    continue;
                }
                match e.local_name().as_ref() {
                    "docDefaults" => defaults_depth = Some(depth),
                    "numPr" => {
                        if let Some((_, style)) = current.as_mut() {
                            style.numbered = true;
                        } else if defaults_depth.is_some() {
                            catalog.defaults_numbered = true;
                        }
                    }
                    "style" if attribute(&e, "type")?.as_deref() == Some("paragraph") => {
                        if current.is_some() {
                            return Err(invalid());
                        }
                        let id = attribute(&e, "styleId")?.ok_or_else(invalid)?;
                        if matches!(
                            attribute(&e, "default")?.as_deref(),
                            Some("1" | "true" | "on")
                        ) && catalog.default.replace(id.clone()).is_some()
                        {
                            return Err(invalid());
                        }
                        current = Some((id, Style::default()));
                    }
                    "outlineLvl" => {
                        if let Some((_, style)) = current.as_mut() {
                            style.heading = attribute(&e, "val")?
                                .and_then(|n| n.parse::<usize>().ok())
                                .filter(|&n| n < 9)
                                .map(|n| n + 1);
                        }
                    }
                    "name" => {
                        if let Some((_, style)) = current.as_mut()
                            && let Some(name) = attribute(&e, "val")?
                        {
                            style.heading = name
                                .to_lowercase()
                                .strip_prefix("heading ")
                                .and_then(|n| n.parse().ok())
                                .filter(|n| (1..=9).contains(n));
                        }
                    }
                    "basedOn" => {
                        if let Some((_, style)) = current.as_mut() {
                            style.parent = attribute(&e, "val")?;
                        }
                    }
                    _ => {}
                }
            }
            Event::End(e) => {
                if defaults_depth == Some(depth) {
                    defaults_depth = None;
                }
                depth = depth.checked_sub(1).ok_or_else(invalid)?;
                if word(&ns)
                    && e.local_name().as_ref() == "style"
                    && let Some((id, style)) = current.take()
                    && definitions.insert(id, style).is_some()
                {
                    return Err(invalid());
                }
            }
            Event::DocType(_) => return Err(invalid()),
            Event::Decl(e) => declaration(&e)?,
            Event::Eof => {
                if depth != 0 {
                    return Err(invalid());
                }
                break;
            }
            _ => {}
        }
    }
    for id in definitions.keys() {
        let mut seen = HashSet::new();
        let mut next = Some(id.as_str());
        while let Some(key) = next {
            if !seen.insert(key) || seen.len() > 32 {
                return Err(invalid());
            }
            let Some(style) = definitions.get(key) else {
                break;
            };
            if let Some(level) = style.heading {
                catalog.headings.entry(id.clone()).or_insert(level);
            }
            if style.numbered || catalog.numbered.contains(key) {
                catalog.numbered.insert(id.clone());
            }
            next = style.parent.as_deref();
        }
    }
    Ok(catalog)
}
pub(crate) fn extract(bytes: &[u8]) -> Result<ParsedDocx> {
    if bytes.len() > INPUT_LIMIT {
        return Err(invalid());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
    if archive.len() > 4096 {
        return Err(invalid());
    }
    let mut parts = HashMap::new();
    let mut names = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| invalid())?;
        let name = entry.name().map_err(|_| invalid())?.into_owned();
        if name.contains('\\')
            || name.starts_with('/')
            || name.split('/').any(|p| p == "..")
            || !names.insert(name.clone())
            || entry.encrypted()
        {
            return Err(invalid());
        }
        total = total.checked_add(entry.size()).ok_or_else(invalid)?;
        if total > 64 * 1024 * 1024 {
            return Err(invalid());
        }
        let lowercase_name = name.to_ascii_lowercase();
        if [
            "word/media/",
            "word/embeddings/",
            "word/header",
            "word/footer",
            "word/footnotes",
            "word/endnotes",
            "word/comments",
            "word/vba",
        ]
        .iter()
        .any(|prefix| lowercase_name.starts_with(prefix))
        {
            return Err(unsupported());
        }
        if ["word/document.xml", "word/styles.xml", "word/numbering.xml"].contains(&name.as_str()) {
            if entry.size() > PART_LIMIT as u64 {
                return Err(invalid());
            }
            let mut data = Vec::new();
            entry.take((PART_LIMIT + 1) as u64).read_to_end(&mut data)?;
            if data.len() > PART_LIMIT {
                return Err(invalid());
            }
            parts.insert(name, data);
        }
    }
    let styles = styles(
        parts.get("word/styles.xml"),
        parts.get("word/numbering.xml"),
    )?;
    let mut reader = xml(parts.get("word/document.xml").ok_or_else(invalid)?)?;
    let mut depth = 0usize;
    let mut body = false;
    let mut bodies = 0;
    let mut in_paragraph = false;
    let mut in_text = false;
    let mut paragraph = String::new();
    let mut heading = None;
    let mut paragraph_style = None;
    let mut table = false;
    let mut cell = None::<String>;
    let mut row = Vec::new();
    let mut rows = Vec::<Vec<String>>::new();
    let mut markdown = String::new();
    let mut sections = Vec::new();
    let mut section_body = String::new();
    let mut heading_stack = Vec::<(usize, String)>::new();
    loop {
        let (ns, event) = reader.read_resolved_event().map_err(|_| invalid())?;
        match event {
            Event::Start(e) => {
                depth += 1;
                if depth > 128 {
                    return Err(invalid());
                }
                if depth == 1
                    && (!word(&ns) || e.local_name().as_ref() != "document" || bodies != 0)
                {
                    return Err(invalid());
                }
                if !word(&ns) {
                    if body {
                        return Err(unsupported());
                    }
                    continue;
                }
                let local = e.local_name();
                let name = local.as_ref();
                if [
                    "drawing",
                    "pict",
                    "object",
                    "altChunk",
                    "del",
                    "ins",
                    "moveFrom",
                    "moveTo",
                    "numPr",
                    "fldChar",
                    "fldSimple",
                    "instrText",
                    "footnoteReference",
                    "endnoteReference",
                    "headerReference",
                    "footerReference",
                    "commentReference",
                    "hyperlink",
                    "sym",
                    "sdt",
                    "subDoc",
                    "contentPart",
                    "control",
                ]
                .contains(&name)
                {
                    return Err(unsupported());
                }
                match name {
                    "body" => {
                        if body || bodies != 0 || depth != 2 {
                            return Err(invalid());
                        }
                        body = true;
                        bodies += 1;
                    }
                    "p" if body => {
                        if in_paragraph {
                            return Err(invalid());
                        }
                        in_paragraph = true;
                        paragraph.clear();
                        paragraph_style = styles.default.clone();
                        heading = paragraph_style
                            .as_ref()
                            .and_then(|id| styles.headings.get(id).copied());
                    }
                    "pStyle" if in_paragraph => {
                        paragraph_style = attribute(&e, "val")?;
                        heading = paragraph_style
                            .as_ref()
                            .and_then(|id| styles.headings.get(id).copied());
                    }
                    "outlineLvl" if in_paragraph => {
                        heading = attribute(&e, "val")?
                            .and_then(|s| s.parse::<usize>().ok())
                            .filter(|&n| n < 9)
                            .map(|n| n + 1);
                    }
                    "t" if in_paragraph => {
                        if in_text {
                            return Err(invalid());
                        }
                        in_text = true;
                    }
                    "tab" if in_paragraph => paragraph.push('\t'),
                    "br" | "cr" if in_paragraph => paragraph.push('\n'),
                    "softHyphen" if in_paragraph => paragraph.push('\u{00ad}'),
                    "noBreakHyphen" if in_paragraph => paragraph.push('\u{2011}'),
                    "tbl" if body => {
                        if table {
                            return Err(unsupported());
                        }
                        table = true;
                        rows.clear();
                    }
                    "tr" if table && !row.is_empty() => return Err(invalid()),
                    "tc" if table => {
                        if cell.is_some() {
                            return Err(invalid());
                        }
                        cell = Some(String::new());
                    }
                    "gridSpan" | "vMerge" | "hMerge" if table => return Err(unsupported()),
                    _ => {}
                }
            }
            Event::Text(e) if in_text => paragraph.push_str(&e.xml10_content()),
            Event::CData(e) if in_text => paragraph.push_str(&e.xml10_content()),
            Event::Text(e) if body && !e.xml10_content().trim().is_empty() => return Err(invalid()),
            Event::GeneralRef(e) if in_text => {
                if let Some(c) = e.resolve_char_ref().map_err(|_| invalid())? {
                    paragraph.push(c);
                } else {
                    paragraph.push_str(match e.as_ref() {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "apos" => "'",
                        "quot" => "\"",
                        _ => return Err(invalid()),
                    });
                }
            }
            Event::End(e) => {
                depth = depth.checked_sub(1).ok_or_else(invalid)?;
                if !word(&ns) {
                    continue;
                }
                match e.local_name().as_ref() {
                    "t" => in_text = false,
                    "p" if in_paragraph => {
                        if styles.defaults_numbered
                            || paragraph_style
                                .as_ref()
                                .is_some_and(|id| styles.numbered.contains(id))
                        {
                            return Err(unsupported());
                        }
                        in_paragraph = false;
                        if let Some(cell) = cell.as_mut() {
                            if !cell.is_empty() {
                                cell.push(' ');
                            }
                            cell.push_str(paragraph.trim());
                        } else if !paragraph.trim().is_empty() {
                            if let Some(level) = heading {
                                flush_section(&mut sections, &mut section_body, &heading_stack);
                                while heading_stack.last().is_some_and(|(n, _)| *n >= level) {
                                    heading_stack.pop();
                                }
                                heading_stack.push((level, paragraph.trim().to_owned()));
                                markdown.push_str(&"#".repeat(level));
                                markdown.push(' ');
                            } else {
                                section_body.push_str(paragraph.trim());
                                section_body.push_str("\n\n");
                            }
                            markdown.push_str(paragraph.trim());
                            markdown.push_str("\n\n");
                        }
                    }
                    "tc" if table => row.push(cell.take().ok_or_else(invalid)?),
                    "tr" if table => {
                        if row.is_empty() {
                            return Err(invalid());
                        }
                        rows.push(std::mem::take(&mut row));
                    }
                    "tbl" if table => {
                        table = false;
                        if rows.is_empty() {
                            return Err(invalid());
                        }
                        let columns = rows[0].len();
                        if columns > 100 || rows.iter().any(|r| r.len() != columns) {
                            return Err(unsupported());
                        }
                        let table_start = markdown.len();
                        for (i, row) in rows.drain(..).enumerate() {
                            markdown.push('|');
                            for text in row {
                                markdown.push_str(&text.replace('|', "\\|"));
                                markdown.push('|');
                            }
                            markdown.push('\n');
                            if i == 0 {
                                markdown.push('|');
                                for _ in 0..columns {
                                    markdown.push_str("---|");
                                }
                                markdown.push('\n');
                            }
                        }
                        markdown.push('\n');
                        section_body.push_str(&markdown[table_start..]);
                    }
                    "body" => body = false,
                    _ => {}
                }
            }
            Event::DocType(_) => return Err(invalid()),
            Event::Decl(e) => declaration(&e)?,
            Event::Eof => {
                if depth != 0 || bodies != 1 || body || table || in_paragraph || in_text {
                    return Err(invalid());
                }
                break;
            }
            _ => {}
        }
        if markdown.len()
            + paragraph.len()
            + cell.as_ref().map_or(0, String::len)
            + rows.iter().flatten().map(String::len).sum::<usize>()
            > OUTPUT_LIMIT
        {
            return Err(invalid());
        }
    }
    if markdown.trim().is_empty() {
        return Err(invalid());
    }
    flush_section(&mut sections, &mut section_body, &heading_stack);
    Ok(ParsedDocx { markdown, sections })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_headings_and_untrusted_literals_survive() {
        let result = extract(include_bytes!("../tests/fixtures/synthetic.docx")).unwrap();
        assert!(result.markdown.starts_with("# Reisen\n"));
        assert!(result.markdown.contains("# Untrusted text\n"));
        assert!(result.markdown.contains("Grüße aus Köln"));
        assert!(
            result
                .markdown
                .contains("<script>window.__documentExecuted=true</script>")
        );
        assert!(result.markdown.contains("ALPHA-47"));
    }
    #[test]
    fn table_cells_remain_in_rows() {
        let result = extract(include_bytes!("../tests/fixtures/table.docx")).unwrap();
        assert!(
            result
                .markdown
                .contains("|City|Country|\n|---|---|\n|Berlin|Deutschland|\n|London|England|")
        );
    }
    #[test]
    fn literal_markdown_is_not_reinterpreted_as_docx_heading_metadata() {
        let result = extract(include_bytes!("../tests/fixtures/literal.docx")).unwrap();
        assert!(
            result
                .sections
                .iter()
                .any(|s| s.text.contains("# Literal source text"))
        );
        assert!(result.sections.iter().all(|s| {
            !s.heading_path
                .iter()
                .any(|h| h.contains("Literal source text"))
        }));
    }
    #[test]
    fn unsupported_content_and_entities_fail_the_whole_document() {
        for bytes in [
            include_bytes!("../tests/fixtures/revision.docx").as_slice(),
            include_bytes!("../tests/fixtures/list.docx"),
            include_bytes!("../tests/fixtures/dtd.docx"),
            include_bytes!("../tests/fixtures/image.docx"),
            include_bytes!("../tests/fixtures/uppercase-media.docx"),
            include_bytes!("../tests/fixtures/header-reference.docx"),
            include_bytes!("../tests/fixtures/inherited-list.docx"),
            include_bytes!("../tests/fixtures/default-list.docx"),
            include_bytes!("../tests/fixtures/style-linked-list.docx"),
        ] {
            assert!(extract(bytes).is_err());
        }
        assert!(extract(b"not a ZIP").is_err());
    }
}
