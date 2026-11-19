//! Bounded numeric interpretation of complete source functions, never JavaScript
//! execution. Port of qa/sourceCalculations.ts, not deployment/authority evidence.
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};
const SPACE: &str = r"[\x09-\x0d\x20\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";
fn js_regex(pattern: &str) -> Regex {
    Regex::new(
        &pattern
            .replace(r"\s", SPACE)
            .replace(r"\w", "[A-Za-z0-9_]")
            .replace(r"\d", "[0-9]"),
    )
    .expect("fixed arithmetic pattern")
}
macro_rules! rx {
    ($p:literal) => {{
        static RX: LazyLock<Regex> = LazyLock::new(|| js_regex($p));
        &*RX
    }};
}
fn space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn trim(s: &str) -> &str {
    s.trim_matches(space)
}
fn units(s: &str) -> usize {
    s.encode_utf16().count()
}
fn reserved(name: &str) -> bool {
    "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield arguments eval".split(' ').any(|s|s==name)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalculationPassage {
    pub document_id: i64,
    pub chunk_id: i64,
    pub document_title: String,
    pub text: String,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceCalculation {
    pub document_id: i64,
    pub chunk_id: i64,
    pub start: usize,
    pub end: usize,
    pub source: String,
    pub call: String,
    pub result: f64,
}
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct CalculationResult {
    pub calculations: Vec<SourceCalculation>,
    pub annotation: String,
}
#[derive(Clone)]
struct Call {
    call: String,
    args: Vec<f64>,
}
#[derive(Clone)]
struct Binding {
    literal: String,
    value: f64,
}
fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}
fn number_prefix(s: &str) -> Option<&str> {
    rx!(r"^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?")
        .find(s)
        .map(|m| m.as_str())
}
struct Expression<'a> {
    tokens: Vec<&'a str>,
    at: usize,
    variables: &'a HashMap<String, f64>,
}
impl Expression<'_> {
    fn take(&mut self, expected: &str) -> Option<()> {
        let found = self.tokens.get(self.at)?;
        self.at += 1;
        (*found == expected).then_some(())
    }
    fn peek(&self) -> &str {
        self.tokens.get(self.at).copied().unwrap_or("")
    }
    fn primary(&mut self, depth: usize) -> Option<f64> {
        if depth > 24 {
            return None;
        }
        let token = *self.tokens.get(self.at)?;
        self.at += 1;
        match token {
            "+" => return self.primary(depth + 1),
            "-" => return self.primary(depth + 1).map(|v| -v),
            "(" => {
                let value = self.sum(depth + 1)?;
                self.take(")")?;
                return Some(value);
            }
            _ => {}
        }
        if number_prefix(token) == Some(token) {
            return finite(token.parse().ok()?);
        }
        if let Some(value) = self.variables.get(token) {
            return Some(*value);
        }
        if token != "Math" {
            return None;
        }
        self.take(".")?;
        let name = *self.tokens.get(self.at)?;
        self.at += 1;
        let (min, max) = match name {
            "min" | "max" => (1, 8),
            "abs" | "floor" | "ceil" | "round" | "trunc" => (1, 1),
            _ => return None,
        };
        self.take("(")?;
        let mut args = vec![];
        if self.peek() != ")" {
            args.push(self.sum(depth + 1)?);
            while self.peek() == "," {
                self.at += 1;
                if args.len() >= max {
                    return None;
                }
                args.push(self.sum(depth + 1)?);
            }
        }
        self.take(")")?;
        if args.len() < min || args.len() > max {
            return None;
        }
        let value = args[0];
        finite(match name {
            "abs" => value.abs(),
            "floor" => value.floor(),
            "ceil" => value.ceil(),
            "trunc" => value.trunc(),
            "round" => {
                if (-0.5..0.0).contains(&value) {
                    -0.0
                } else {
                    let floor = value.floor();
                    if value - floor >= 0.5 {
                        floor + 1.0
                    } else {
                        floor
                    }
                }
            }
            "min" => args.into_iter().reduce(|a, b| {
                if a < b || (a == 0.0 && b == 0.0 && a.is_sign_negative()) {
                    a
                } else {
                    b
                }
            })?,
            "max" => args.into_iter().reduce(|a, b| {
                if a > b || (a == 0.0 && b == 0.0 && a.is_sign_positive()) {
                    a
                } else {
                    b
                }
            })?,
            _ => return None,
        })
    }
    fn product(&mut self, depth: usize) -> Option<f64> {
        let mut value = self.primary(depth)?;
        while matches!(self.peek(), "*" | "/" | "%") {
            let op = self.tokens[self.at];
            self.at += 1;
            let right = self.primary(depth)?;
            value = finite(match op {
                "*" => value * right,
                "/" => value / right,
                _ => value % right,
            })?;
        }
        Some(value)
    }
    fn sum(&mut self, depth: usize) -> Option<f64> {
        let mut value = self.product(depth)?;
        while matches!(self.peek(), "+" | "-") {
            let op = self.tokens[self.at];
            self.at += 1;
            let right = self.product(depth)?;
            value = finite(if op == "+" {
                value + right
            } else {
                value - right
            })?;
        }
        Some(value)
    }
}
fn numeric(expression: &str, variables: &HashMap<String, f64>) -> Option<f64> {
    if units(expression) > 700 || rx!(r"\+\+|--|\*\*|//|/\*").is_match(expression) {
        return None;
    }
    let mut tokens = vec![];
    let mut rest = expression;
    while !rest.is_empty() {
        rest = rest.trim_start_matches(space);
        if rest.is_empty() {
            break;
        }
        let token = number_prefix(rest)
            .or_else(|| rx!(r"^[A-Za-z_$][\w$]*").find(rest).map(|m| m.as_str()))
            .or_else(|| rx!(r"^[+\-*/%(),.]").find(rest).map(|m| m.as_str()))?;
        if rx!(r"^0\d").is_match(token) || tokens.len() >= 256 {
            return None;
        }
        tokens.push(token);
        rest = &rest[token.len()..];
    }
    let mut parser = Expression {
        tokens,
        at: 0,
        variables,
    };
    let value = parser.sum(0)?;
    (parser.at == parser.tokens.len()).then_some(value)
}
fn strip_comments(text: &str) -> String {
    let block = rx!(r"(?s)/\*.*?\*/").replace_all(text, " ");
    rx!(r"//[^\r\n]*").replace_all(&block, " ").into_owned()
}
fn unsupported_prefix(question: &str, start: usize) -> bool {
    let before = &question[..start];
    if rx!(r"[\p{ID_Continue}$\\\u{200c}\u{200d}]$").is_match(before) {
        return true;
    }
    let previous = strip_comments(before);
    let previous = previous.trim_end_matches(space);
    previous.ends_with('.') || rx!(r"(?:^|[^\p{ID_Continue}$])new$").is_match(previous)
}
fn bindings(question: &str) -> HashMap<String, Option<Binding>> {
    let mut inputs = HashMap::new();
    for m in rx!(r"([A-Za-z_$][\w$]{0,63})\s*([+\-*/%&|^]?=)").captures_iter(question) {
        let name = &m[1];
        if inputs.contains_key(name) {
            inputs.insert(name.to_owned(), None);
            continue;
        }
        let full = m.get(0).unwrap();
        let rest = question[full.end()..].trim_start_matches(space);
        let literal = rx!(r"^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?")
            .find(rest)
            .map(|m| m.as_str());
        let after = literal.map_or("", |s| &rest[s.len()..]);
        let tail = after.trim_start_matches(space);
        let value = literal.and_then(|s| s.parse::<f64>().ok()).and_then(finite);
        let unsupported = unsupported_prefix(question, full.start())
            || rx!(r"\p{Cf}$").is_match(&question[..full.start()])
            || &m[2] != "="
            || value.is_none()
            || (!after.is_empty() && !rx!(r#"^[\s,;'"`!?]"#).is_match(after))
            || rx!(r"^[\p{ID_Continue}$\\.\u{200c}\u{200d}]").is_match(after)
            || rx!(r"^[\p{Cf}\p{Sc}\p{N}\u{066b}\u{066c}\u{ff0c}\u{ff0e}‰‱]").is_match(tail)
            || tail
                .chars()
                .next()
                .is_some_and(|c| "+-*/%<>=&|^?:()[]{}\\×÷−–—·∙⋅∕⁄~≈≤≥±√∛∜".contains(c))
            || rx!(r"^,\s*(?:[+\-.\d]|\(|\[|\])").is_match(tail)
            || rx!(r"^['’]\s*\d").is_match(tail)
            || rx!(r"^\s+\d").is_match(after);
        inputs.insert(
            name.to_owned(),
            if unsupported {
                None
            } else {
                Some(Binding {
                    literal: literal.unwrap().into(),
                    value: value.unwrap(),
                })
            },
        );
    }
    inputs
}
fn named_call(
    question: &str,
    name: &str,
    parameters: &[String],
    inputs: &HashMap<String, Option<Binding>>,
) -> Vec<Call> {
    if parameters.is_empty() {
        return vec![];
    }
    let Some(values) = parameters
        .iter()
        .map(|p| inputs.get(p)?.as_ref())
        .collect::<Option<Vec<_>>>()
    else {
        return vec![];
    };
    let mut mentioned = false;
    for (start, _) in question.match_indices(name) {
        let after = &question[start + name.len()..];
        if rx!(r"^[\p{ID_Continue}$\\\u{200c}\u{200d}]").is_match(after) {
            continue;
        }
        if unsupported_prefix(question, start) || rx!(r"\p{Cf}$").is_match(&question[..start]) {
            return vec![];
        }
        let next = strip_comments(after);
        if rx!(r"^(?:\p{Cf}|\(|\[|[.=]|\?\s*\.)").is_match(next.trim_start_matches(space)) {
            return vec![];
        }
        mentioned = true;
    }
    if !mentioned {
        return vec![];
    }
    vec![Call {
        call: format!(
            "{}({})",
            name,
            values
                .iter()
                .map(|v| v.literal.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        args: values.iter().map(|v| v.value).collect(),
    }]
}
fn code_windows(passage: &CalculationPassage) -> Vec<(usize, &str)> {
    if rx!(r"(?i-u)\.(?:[cm]?[jt]s)$").is_match(&passage.document_title) {
        return vec![(0, &passage.text)];
    }
    let text = &passage.text;
    let mut result = vec![];
    let mut cursor = 0;
    let opening = rx!(
        r"(?:^|[\r\n\u{2028}\u{2029}]) {0,3}(`{3,}|~{3,})(?:js|ts|javascript|typescript)[ \t]*\r?\n"
    );
    while let Some(m) = opening.captures_at(text, cursor) {
        let full = m.get(0).unwrap();
        let start = full.end();
        let closing = js_regex(&format!(
            r"(?:^|[\r\n\u{{2028}}\u{{2029}}])( {{0,3}}{}[ \t]*\r?)(?:$|[\r\n\u{{2028}}\u{{2029}}])",
            regex::escape(&m[1])
        ));
        if let Some(capture) = closing.captures_at(text, start) {
            let end = capture.get(1).unwrap();
            result.push((start, &text[start..end.start()]));
            cursor = end.end();
        } else {
            cursor = start;
        }
    }
    result
}
fn supported_bindings(name: &str, parameters: &str) -> bool {
    !reserved(name)
        && (trim(parameters).is_empty()
            || parameters.split(',').all(|p| {
                rx!(r"^([A-Za-z_$][\w$]*)(?:\s*:\s*number)?$")
                    .captures(trim(p))
                    .is_some_and(|m| !reserved(&m[1]))
            }))
}
pub(crate) fn js_number(value: f64) -> String {
    if value == 0.0 {
        return if value.is_sign_negative() { "-0" } else { "0" }.into();
    }
    if value.abs() >= 1e21 || value.abs() < 1e-6 {
        let result = format!("{value:e}");
        let (base, exponent) = result.split_once('e').unwrap();
        let exponent: i32 = exponent.parse().unwrap();
        format!("{base}e{exponent:+}")
    } else {
        value.to_string()
    }
}

/// Interpret only supported complete straight-line declarations, with explicit
/// literal calls or named literal bindings. Unsupported syntax is omitted.
pub fn annotate(question: &str, passages: &[CalculationPassage]) -> CalculationResult {
    let mut output = CalculationResult {
        calculations: vec![],
        annotation: String::new(),
    };
    if trim(question).is_empty() || units(question) > 4096 {
        return output;
    }
    let mut calls = HashMap::<String, Vec<Call>>::new();
    for m in rx!(r"([A-Za-z_$][\w$]{0,63})\(([\d\s.,eE+-]{1,100})\)").captures_iter(question) {
        let full = m.get(0).unwrap();
        if unsupported_prefix(question, full.start()) {
            continue;
        }
        let inputs = m[2].split(',').map(trim).collect::<Vec<_>>();
        if inputs.len() > 4
            || inputs.iter().any(|s| {
                !rx!(r"^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$").is_match(s)
            })
        {
            continue;
        }
        let Some(args) = inputs
            .iter()
            .map(|s| s.parse::<f64>().ok().and_then(finite))
            .collect::<Option<Vec<_>>>()
        else {
            continue;
        };
        let list = calls.entry(m[1].into()).or_default();
        if !list.iter().any(|c| c.call == full.as_str()) {
            list.push(Call {
                call: full.as_str().into(),
                args,
            });
        }
    }
    let bindings = bindings(question);
    if calls.is_empty() && bindings.is_empty() {
        return output;
    }
    let mut seen = HashSet::new();
    for passage in passages.iter().take(16) {
        if !(1..=9_007_199_254_740_991).contains(&passage.document_id)
            || !(1..=9_007_199_254_740_991).contains(&passage.chunk_id)
            || units(&passage.text) > 16_000
        {
            continue;
        }
        if !seen.insert((passage.document_id, passage.chunk_id)) {
            continue;
        }
        if passages.iter().take(16).any(|p| {
            p.document_id == passage.document_id
                && p.chunk_id == passage.chunk_id
                && (p.text != passage.text || p.document_title != passage.document_title)
        }) {
            continue;
        }
        for (offset, window) in code_windows(passage) {
            // Capture the declaration separately from its line-boundary prefix.
            let declaration = rx!(
                r"(?:^|[\r\n\u{2028}\u{2029}])([ \t]*(?:export\s+(?:default\s+)?)?function\s+([A-Za-z_$][\w$]{0,63})\s*\(([^(){}]{0,160})\)\s*(?::\s*number\s*)?\{\s*return[ \t]+([^{};]{1,700});?\s*\})"
            );
            let functions = declaration.captures_iter(window).collect::<Vec<_>>();
            if !trim(&declaration.replace_all(window, "")).is_empty()
                || functions
                    .iter()
                    .any(|m| &m[2] == "Math" || !supported_bindings(&m[2], &m[3]))
            {
                continue;
            }
            for m in &functions {
                if rx!(r"^[\s&&[^\r\n\u{2028}\u{2029}]]*[\r\n\u{2028}\u{2029}]").is_match(&m[4]) {
                    continue;
                }
                let name = &m[2];
                if reserved(name) || functions.iter().filter(|f| &f[2] == name).count() != 1 {
                    continue;
                }
                let parameters = m[3].split(',').map(trim).collect::<Vec<_>>();
                if parameters.len() > 4
                    || parameters
                        .iter()
                        .any(|p| !rx!(r"^[A-Za-z_$][\w$]*(?:\s*:\s*number)?$").is_match(p))
                {
                    continue;
                }
                let names = parameters
                    .iter()
                    .map(|p| trim(p.split(':').next().unwrap()).to_owned())
                    .collect::<Vec<_>>();
                if names.iter().collect::<HashSet<_>>().len() != names.len()
                    || names.iter().any(|s| s == "Math" || reserved(s))
                {
                    continue;
                }
                let requested = calls
                    .get(name)
                    .cloned()
                    .unwrap_or_else(|| named_call(question, name, &names, &bindings));
                for call in requested {
                    if output.calculations.len() >= 16 {
                        break;
                    }
                    if call.args.len() != names.len() {
                        continue;
                    }
                    let vars = names.iter().cloned().zip(call.args).collect();
                    let Some(result) = numeric(&m[4], &vars) else {
                        continue;
                    };
                    let full = m.get(1).unwrap();
                    let start = units(&passage.text[..offset + full.start()]);
                    output.calculations.push(SourceCalculation {
                        document_id: passage.document_id,
                        chunk_id: passage.chunk_id,
                        start,
                        end: start + units(full.as_str()),
                        source: full.as_str().into(),
                        call: call.call,
                        result,
                    });
                }
            }
        }
    }
    if !output.calculations.is_empty() {
        let lines = output
            .calculations
            .iter()
            .map(|c| {
                format!(
                    "[doc:{}, chunk:{}] {} = {}",
                    c.document_id,
                    c.chunk_id,
                    c.call,
                    js_number(c.result)
                )
            })
            .collect::<Vec<_>>();
        output.annotation = format!(
            "Numeric interpretation of the shown functions with standard JavaScript Math only; this does not establish deployment, authority or applicability.\n{}",
            lines.join("\n")
        );
    }
    output
}
