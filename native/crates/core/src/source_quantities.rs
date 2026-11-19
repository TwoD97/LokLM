//! Literal unit arithmetic ported from qa/sourceQuantities.ts. Exact conversions
//! do not establish shared scope, authority, applicability or factual support.
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

const HEADER: &str = "Exact unit arithmetic only; these conversions do not establish shared scope, authority, or applicability.";
const JS_SPACE: &str = r"[\x09-\x0d\x20\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";
const SAFE_ID: i64 = 9_007_199_254_740_991;
pub const PASSAGES: usize = 16;
pub const PASSAGE_UTF16: usize = 16_000;
pub const TOTAL_UTF16: usize = 64_000;
pub const QUANTITIES: usize = 32;
pub const ANNOTATION_UTF16: usize = 6_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantityPassage {
    pub document_id: i64,
    pub chunk_id: i64,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceQuantity {
    pub id: String,
    pub document_id: i64,
    pub chunk_id: i64,
    /// UTF-16 offsets into the intact original text; end exclusive.
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub dimension: String,
    pub normalized: NormalizedQuantity,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NormalizedQuantity {
    pub numerator: String,
    pub denominator: String,
    pub value: String,
    pub unit: String,
}
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuantityResult {
    pub quantities: Vec<SourceQuantity>,
    pub annotation: String,
    /// A resource bound excluded input/output; false does not mean semantic completeness.
    pub limited: bool,
}
#[derive(Clone, Copy)]
struct Unit {
    dimension: &'static str,
    base: &'static str,
    numerator: u128,
    denominator: u128,
}
struct Patterns {
    units: HashMap<String, Unit>,
    quantity: Regex,
    boundary: Regex,
    before: Vec<Regex>,
    after: Vec<Regex>,
    standalone: Regex,
    trim_start: Regex,
    decimal: Regex,
    comma: Regex,
    grouping: Regex,
}
fn re(s: &str) -> Regex {
    Regex::new(s).expect("fixed quantity pattern")
}
static PATTERNS: LazyLock<Patterns> = LazyLock::new(|| {
    let mut units = HashMap::new();
    let mut add = |names: &[&str], dimension, base, numerator, denominator| {
        let unit = Unit {
            dimension,
            base,
            numerator,
            denominator,
        };
        for &name in names {
            units.insert(name.to_owned(), unit);
        }
    };
    add(
        &[
            "ms",
            "millisecond",
            "milliseconds",
            "Millisekunde",
            "Millisekunden",
        ],
        "duration",
        "s",
        1,
        1000,
    );
    add(
        &["s", "second", "seconds", "Sekunde", "Sekunden"],
        "duration",
        "s",
        1,
        1,
    );
    add(
        &["min", "minute", "minutes", "Minute", "Minuten"],
        "duration",
        "s",
        60,
        1,
    );
    add(
        &["h", "hour", "hours", "Stunde", "Stunden"],
        "duration",
        "s",
        3600,
        1,
    );
    add(
        &["day", "days", "Tag", "Tage", "Tagen"],
        "duration",
        "s",
        86400,
        1,
    );
    for (name, numerator, denominator) in [
        ("m", 1, 1),
        ("cm", 1, 100),
        ("mm", 1, 1000),
        ("km", 1000, 1),
    ] {
        add(&[name], "length", "m", numerator, denominator);
    }
    add(&["g"], "mass", "g", 1, 1);
    add(&["kg"], "mass", "g", 1000, 1);
    add(
        &[
            "L", "l", "litre", "litres", "liter", "liters", "Liter", "Litern",
        ],
        "volume",
        "L",
        1,
        1,
    );
    add(
        &[
            "mL",
            "ml",
            "millilitre",
            "millilitres",
            "milliliter",
            "milliliters",
            "Milliliter",
            "Millilitern",
        ],
        "volume",
        "L",
        1,
        1000,
    );
    add(
        &[
            "m³",
            "cubic metre",
            "cubic metres",
            "cubic meter",
            "cubic meters",
            "Kubikmeter",
            "Kubikmetern",
        ],
        "volume",
        "L",
        1000,
        1,
    );
    for (name, unit) in units.clone() {
        if name.encode_utf16().count() > 3 || name == "Tag" {
            units.insert(name.to_lowercase(), unit);
            let first = name.chars().next().unwrap();
            units.insert(
                format!("{}{}", first.to_uppercase(), &name[first.len_utf8()..]),
                unit,
            );
        }
    }
    let mut names = units.keys().collect::<Vec<_>>();
    names.sort_by(|a, b| {
        b.encode_utf16()
            .count()
            .cmp(&a.encode_utf16().count())
            .then_with(|| a.cmp(b))
    });
    let pattern = names
        .into_iter()
        .map(|s| regex::escape(s))
        .collect::<Vec<_>>()
        .join("|");
    // Rust's linear-time regex has no lookaround. Check the original Unicode
    // letter/number/underscore boundaries separately, without consuming them.
    let before = [
        r"\p{Sc}[\t\p{Zs}]*$".to_owned(),
        r"(?:^|[^\p{L}\p{N}_])(?:USD|EUR)[\t\p{Zs}]+$".to_owned(),
        r"[\p{L}\p{N}_.,\u{066b}\u{066c}]$".to_owned(),
        r"[/\\∕⁄+\-−–—±~≈<>≤≥*^×·∙⋅÷√∛∜][\t\p{Zs}]*$".to_owned(),
        r"[0-9](?:[\t\p{Zs}]+|[\t\p{Zs}]*[.,:'’\u{066b}\u{066c}][\t\p{Zs}]*)$".to_owned(),
        format!(r"(?i)(?:about|around|roughly|approximately|circa|ca\.?|ungefähr|etwa|rund|mindestens|höchstens|at least|at most|up to|bis zu|between|zwischen){JS_SPACE}*$"),
        r"(?i)[0-9][\t\p{Zs}]*(?:to|bis|and|und)[\t\p{Zs}]*$".to_owned(),
        format!(r"[0-9][\t\p{{Zs}}]*(?:{pattern})[\t\p{{Zs}}]+$"),
        format!(r"(?:{pattern})[\t\p{{Zs}}]+(?:to|bis|and|und|or|oder)[\t\p{{Zs}}]+$"),
    ].iter().map(|s| re(s)).collect();
    let after = [
        r"^[\t\p{Zs}]*\p{Sc}",
        r"^[\t\p{Zs}]+(?:USD|EUR)(?:$|[^\p{L}\p{N}_])",
        r"(?i)^[\t\p{Zs}]*(?:[/\\∕⁄·∙⋅÷×*^²³⁻%:±]|[-−–—][0-9]|per(?-u:\b)|pro(?-u:\b))",
        r"^[\t\p{Zs}]+(?:[0-9]|[+\-−–—±])",
        r"(?i)^[\t\p{Zs}]+(?:to|bis|and|und|or|oder)[\t\p{Zs}]+[0-9]",
    ]
    .iter()
    .map(|s| re(s))
    .collect();
    Patterns {
        quantity: re(&format!(
            r"([0-9]+(?:[.,][0-9]+)*)([\t\p{{Zs}}]*)(?:{pattern})"
        )),
        boundary: re(r"^[\p{L}\p{N}_]$"),
        standalone: re(&format!(r"^(?:{pattern})(?:$|[^\p{{L}}\p{{N}}_])")),
        trim_start: re(&format!(r"^{JS_SPACE}+")),
        decimal: re(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$"),
        comma: re(r"^(?:0|[1-9][0-9]*),[0-9]{1,2}$"),
        grouping: re(r"^[1-9][0-9]{0,2}\.[0-9]{3}$"),
        units,
        before,
        after,
    }
});
fn utf16(s: &str) -> usize {
    s.encode_utf16().count()
}
fn decimal(s: &str, patterns: &Patterns) -> Option<(u128, u128)> {
    if s.contains(',') && !patterns.comma.is_match(s) {
        return None;
    }
    let value = s.replace(',', ".");
    if !patterns.decimal.is_match(&value) || patterns.grouping.is_match(&value) {
        return None;
    }
    let digits = value.replace('.', "");
    if digits.len() > 18 {
        return None;
    }
    let fraction = value.split_once('.').map_or(0, |(_, part)| part.len());
    Some((digits.parse().ok()?, 10u128.pow(fraction as u32)))
}
fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}
fn exact_decimal(numerator: u128, denominator: u128) -> String {
    let mut value = (numerator / denominator).to_string();
    let mut remainder = numerator % denominator;
    if remainder != 0 {
        value.push('.');
        while remainder != 0 {
            remainder *= 10;
            value.push(char::from(b'0' + (remainder / denominator) as u8));
            remainder %= denominator;
        }
    }
    value
}
fn uncertain(text: &[u16], start: usize, end: usize, patterns: &Patterns) -> bool {
    // Lossy conversion only at this context window's potential half-surrogate
    // edges; original source/returned spans are never rewritten.
    let before = String::from_utf16_lossy(&text[start.saturating_sub(80)..start]);
    let after = String::from_utf16_lossy(&text[end..(end + 40).min(text.len())]);
    patterns.before.iter().any(|p| p.is_match(&before))
        || patterns.after.iter().any(|p| p.is_match(&after))
        || patterns
            .standalone
            .is_match(&patterns.trim_start.replace(&after, ""))
}

/// Bounded exact arithmetic catalog over immutable original passages. No model,
/// file, network, source execution, locale inference or floating-point arithmetic.
pub fn annotate(passages: &[QuantityPassage]) -> QuantityResult {
    let patterns = &*PATTERNS;
    let mut result = QuantityResult {
        quantities: vec![],
        annotation: String::new(),
        limited: passages.len() > PASSAGES,
    };
    let mut texts = HashMap::<(i64, i64), Option<&str>>::new();
    for passage in passages.iter().take(PASSAGES) {
        let key = (passage.document_id, passage.chunk_id);
        if utf16(&passage.text) > PASSAGE_UTF16 {
            result.limited = true;
            texts.insert(key, None);
        } else {
            match texts.get(&key) {
                None => {
                    texts.insert(key, Some(&passage.text));
                }
                Some(Some(previous)) if *previous == passage.text => {}
                _ => {
                    texts.insert(key, None);
                }
            }
        }
    }
    let mut seen = HashSet::new();
    let mut chars = 0;
    let mut annotation_chars = utf16(HEADER);
    let mut lines = vec![];
    for passage in passages.iter().take(PASSAGES) {
        let key = (passage.document_id, passage.chunk_id);
        if !(1..=SAFE_ID).contains(&key.0)
            || !(1..=SAFE_ID).contains(&key.1)
            || !matches!(texts.get(&key), Some(Some(_)))
            || !seen.insert(key)
        {
            continue;
        }
        let source: Vec<u16> = passage.text.encode_utf16().collect();
        if source.len() > PASSAGE_UTF16 || chars + source.len() > TOTAL_UTF16 {
            result.limited = true;
            continue;
        }
        chars += source.len();
        for capture in patterns.quantity.captures_iter(&passage.text) {
            let whole = capture.get(0).unwrap();
            if passage.text[..whole.start()]
                .chars()
                .next_back()
                .is_some_and(|c| patterns.boundary.is_match(&c.to_string()))
                || passage.text[whole.end()..]
                    .chars()
                    .next()
                    .is_some_and(|c| patterns.boundary.is_match(&c.to_string()))
            {
                continue;
            }
            let start = utf16(&passage.text[..whole.start()]);
            let end = start + utf16(whole.as_str());
            if uncertain(&source, start, end, patterns) {
                continue;
            }
            let Some((n, d)) = decimal(&capture[1], patterns) else {
                continue;
            };
            let unit = patterns
                .units
                .get(&whole.as_str()[capture[1].len() + capture[2].len()..])
                .unwrap();
            // At most 18 input digits, factor <=86400, denominator <=10^20:
            // all products and long-division intermediates fit u128 exactly.
            let (n, d) = (n * unit.numerator, d * unit.denominator);
            let divisor = gcd(n, d);
            let (n, d) = (n / divisor, d / divisor);
            let quantity = SourceQuantity {
                id: format!("Q{}", result.quantities.len() + 1),
                document_id: key.0,
                chunk_id: key.1,
                start,
                end,
                text: whole.as_str().to_owned(),
                dimension: unit.dimension.into(),
                normalized: NormalizedQuantity {
                    numerator: n.to_string(),
                    denominator: d.to_string(),
                    value: exact_decimal(n, d),
                    unit: unit.base.into(),
                },
            };
            let line = format!(
                "[doc:{}, chunk:{}] {} = {} {}",
                key.0,
                key.1,
                serde_json::to_string(&quantity.text).unwrap(),
                quantity.normalized.value,
                unit.base
            );
            if result.quantities.len() >= QUANTITIES
                || annotation_chars + utf16(&line) + 1 > ANNOTATION_UTF16
            {
                result.limited = true;
                break;
            }
            annotation_chars += utf16(&line) + 1;
            result.quantities.push(quantity);
            lines.push(line);
        }
    }
    if !lines.is_empty() {
        result.annotation = format!("{HEADER}\n{}", lines.join("\n"));
    }
    result
}
