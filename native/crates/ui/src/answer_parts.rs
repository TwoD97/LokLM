//! Only backend-validated citation positions may become source buttons. The UI
//! never discovers source identities by searching untrusted answer text.
use serde_json::Value;

#[derive(Debug, PartialEq, Eq)]
pub struct Part {
    pub text: String,
    pub chunk_id: Option<i64>,
}
pub fn segments(answer: &str, citations: &[Value], hits: &[Value]) -> Vec<Part> {
    checked_segments(answer, citations, hits).unwrap_or_else(|| {
        vec![Part {
            text: answer.to_owned(),
            chunk_id: None,
        }]
    })
}
fn checked_segments(answer: &str, citations: &[Value], hits: &[Value]) -> Option<Vec<Part>> {
    let units: Vec<_> = answer.encode_utf16().collect();
    let mut cursor = 0;
    let mut parts = Vec::new();
    for citation in citations {
        let document_id = citation["documentId"].as_i64()?;
        let chunk_id = citation["chunkId"].as_i64()?;
        let start = usize::try_from(citation["start"].as_u64()?).ok()?;
        let end = usize::try_from(citation["end"].as_u64()?).ok()?;
        if !(1..=9_007_199_254_740_991).contains(&document_id)
            || !(1..=9_007_199_254_740_991).contains(&chunk_id)
            || start < cursor
            || start >= end
            || end > units.len()
            || !hits.iter().any(|h| {
                h["document_id"].as_i64() == Some(document_id)
                    && h["chunk_id"].as_i64() == Some(chunk_id)
            })
        {
            return None;
        }
        let marker = String::from_utf16(&units[start..end]).ok()?;
        if marker != format!("[doc:{document_id}, chunk:{chunk_id}]") {
            return None;
        }
        parts.push(Part {
            text: String::from_utf16(&units[cursor..start]).ok()?,
            chunk_id: None,
        });
        parts.push(Part {
            text: marker,
            chunk_id: Some(chunk_id),
        });
        cursor = end;
    }
    parts.push(Part {
        text: String::from_utf16(&units[cursor..]).ok()?,
        chunk_id: None,
    });
    Some(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_supplied_positions_become_buttons_after_unicode_and_literals() {
        let prefix = "Grüße 👋 `[doc:7, chunk:11]`\n";
        let marker = "[doc:7, chunk:11]";
        let answer = format!("{prefix}{marker}.");
        let start = prefix.encode_utf16().count();
        let citation = json!({"documentId":7,"chunkId":11,"start":start,"end":start+marker.len()});
        let hits = vec![json!({"document_id":7,"chunk_id":11})];
        let parts = segments(&answer, &[citation], &hits);
        assert_eq!(
            parts,
            vec![
                Part {
                    text: prefix.into(),
                    chunk_id: None
                },
                Part {
                    text: marker.into(),
                    chunk_id: Some(11)
                },
                Part {
                    text: ".".into(),
                    chunk_id: None
                }
            ]
        );
        assert_eq!(
            segments(&answer, &[], &hits),
            vec![Part {
                text: answer,
                chunk_id: None
            }]
        );
    }
    #[test]
    fn invalid_metadata_cannot_leave_earlier_buttons_active() {
        let answer = "[doc:7, chunk:11] 👋";
        let good = json!({"documentId":7,"chunkId":11,"start":0,"end":17});
        let hits = vec![json!({"document_id":7,"chunk_id":11})];
        for bad in [
            json!({"documentId":8,"chunkId":11,"start":0,"end":17}),
            json!({"documentId":7,"chunkId":11,"start":0,"end":999}),
            json!({"documentId":7,"chunkId":11,"start":19,"end":20}),
            json!({"documentId":7,"chunkId":11,"start":-1,"end":17}),
            good.clone(),
        ] {
            assert_eq!(
                segments(answer, &[good.clone(), bad], &hits),
                vec![Part {
                    text: answer.into(),
                    chunk_id: None
                }]
            );
        }
        assert_eq!(
            segments(answer, &[good], &[]),
            vec![Part {
                text: answer.into(),
                chunk_id: None
            }]
        );
    }
}
