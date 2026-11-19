//! Structured QA requires original member order and rejects duplicate decoded
//! keys. Keep this representation local: do not change serde_json features or
//! numeric transport/fingerprints for unrelated checkpoints and providers.
use serde::{
    Deserialize, Serialize,
    de::{self, MapAccess, SeqAccess, Visitor},
    ser::SerializeMap,
};
use serde_json::Value;
use std::{collections::HashSet, fmt};

#[derive(Debug, Clone, PartialEq)]
pub enum OrderedValue {
    Scalar(Value),
    Array(Vec<Self>),
    Object(Vec<(String, Self)>),
}
impl OrderedValue {
    pub fn get(&self, name: &str) -> Option<&Self> {
        match self {
            Self::Object(entries) => entries.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Scalar(v) => v.as_str(),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Self]> {
        match self {
            Self::Array(v) => Some(v),
            _ => None,
        }
    }
    pub fn ordered_keys(&self, wanted: &[&str]) -> bool {
        match self {
            Self::Object(v) => v.iter().map(|(k, _)| k.as_str()).eq(wanted.iter().copied()),
            _ => false,
        }
    }
    pub fn to_value(&self) -> Value {
        match self {
            Self::Scalar(v) => v.clone(),
            Self::Array(v) => Value::Array(v.iter().map(Self::to_value).collect()),
            Self::Object(v) => {
                Value::Object(v.iter().map(|(k, v)| (k.clone(), v.to_value())).collect())
            }
        }
    }
}
impl Serialize for OrderedValue {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Scalar(v) => v.serialize(s),
            Self::Array(v) => v.serialize(s),
            Self::Object(v) => {
                let mut map = s.serialize_map(Some(v.len()))?;
                for (k, v) in v {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}
impl<'de> Deserialize<'de> for OrderedValue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct OrderedVisitor;
        impl<'de> Visitor<'de> for OrderedVisitor {
            type Value = OrderedValue;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("bounded JSON without duplicate members")
            }
            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(Value::Null))
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(
                    serde_json::Number::from_f64(v)
                        .ok_or_else(|| E::custom("nonfinite number"))?
                        .into(),
                ))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Self::Value, E> {
                Ok(OrderedValue::Scalar(v.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(v) = seq.next_element()? {
                    values.push(v);
                }
                Ok(OrderedValue::Array(values))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                let mut keys = HashSet::new();
                while let Some(k) = map.next_key::<String>()? {
                    if !keys.insert(k.clone()) {
                        return Err(de::Error::custom("duplicate member"));
                    }
                    values.push((k, map.next_value()?));
                }
                Ok(OrderedValue::Object(values))
            }
        }
        d.deserialize_any(OrderedVisitor)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeRejection {
    Bounds,
    Json,
}
pub fn parse(raw: &str) -> Result<OrderedValue, DecodeRejection> {
    if raw.encode_utf16().count() > 256_000 {
        return Err(DecodeRejection::Bounds);
    }
    // serde's recursion ceiling and strict Unicode/finite number decoding are
    // additional fail-closed transport bounds; errors never include model text.
    serde_json::from_str(raw).map_err(|_| DecodeRejection::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn order_duplicates_and_transport_bounds() {
        let raw =
            r#"{"check":"ok","result":{"text":"literal {\"x\":1,\"x\":2}","sources":["1:2"]}}"#;
        let value = parse(raw).unwrap();
        assert!(value.ordered_keys(&["check", "result"]));
        assert!(
            value
                .get("result")
                .unwrap()
                .ordered_keys(&["text", "sources"])
        );
        assert_eq!(serde_json::to_string(&value).unwrap(), raw);
        for invalid in [
            r#"{"check":1,"\u0063heck":2}"#,
            r#"[{"x":1,"x":2}]"#,
            r#"{"text":"\ud800"}"#,
            "1e999",
            "true false",
        ] {
            assert_eq!(parse(invalid), Err(DecodeRejection::Json));
        }
        assert_eq!(
            parse(&format!("{}0{}", "[".repeat(130), "]".repeat(130))),
            Err(DecodeRejection::Json)
        );
        assert_eq!(
            parse(&format!("\"{}\"", "😀".repeat(128_000))),
            Err(DecodeRejection::Bounds)
        );
    }
}
