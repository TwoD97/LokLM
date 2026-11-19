//! Streaming output guards. Never publish a partial thinking delimiter.
/// A token can end in the middle of a Unicode scalar. EOG must flush the
/// decoder, otherwise an incomplete final scalar would silently disappear.
pub struct Utf8Decoder(encoding_rs::Decoder);
impl Default for Utf8Decoder {
    fn default() -> Self {
        Self(encoding_rs::UTF_8.new_decoder_without_bom_handling())
    }
}
impl Utf8Decoder {
    pub fn decode(&mut self, bytes: &[u8], last: bool) -> crate::Result<String> {
        let capacity = self
            .0
            .max_utf8_buffer_length(bytes.len())
            .ok_or_else(|| crate::fail("Token decode capacity"))?;
        let mut text = String::with_capacity(capacity);
        let (_, read, broken) = self.0.decode_to_string(bytes, &mut text, last);
        if read != bytes.len() || broken {
            return Err(crate::fail("Invalid model UTF-8 output"));
        }
        Ok(text)
    }
}
#[derive(Default)]
pub struct ThinkFilter {
    buf: String,
    inside: bool,
}
impl ThinkFilter {
    pub fn feed(&mut self, text: &str) -> String {
        self.buf.push_str(text);
        let mut out = String::new();
        loop {
            let tag = if self.inside { "</think>" } else { "<think>" };
            if let Some(pos) = self.buf.find(tag) {
                if !self.inside {
                    out.push_str(&self.buf[..pos]);
                }
                self.buf.drain(..pos + tag.len());
                self.inside = !self.inside;
            } else {
                let keep = (1..tag.len())
                    .rev()
                    .find(|n| self.buf.ends_with(&tag[..*n]))
                    .unwrap_or(0);
                let end = self.buf.len() - keep;
                if !self.inside {
                    out.push_str(&self.buf[..end]);
                }
                self.buf.drain(..end);
                break;
            }
        }
        out
    }
    pub fn finish(&mut self) -> String {
        // Only a partial delimiter can remain outside; discard it. All text
        // inside an unterminated think block is private and stays discarded.
        self.buf.clear();
        self.inside = false;
        String::new()
    }
}
#[derive(Default)]
pub struct LoopDetector {
    buf: Vec<char>,
    tripped: bool,
}
impl LoopDetector {
    pub fn feed(&mut self, text: &str) -> bool {
        if self.tripped {
            return true;
        }
        self.buf.extend(text.chars());
        if self.buf.len() > 1024 {
            self.buf.drain(..self.buf.len() - 1024);
        }
        if self.buf.len() < 120 {
            return false;
        }
        let probe = &self.buf[self.buf.len() - 40..];
        if !probe
            .iter()
            .any(|c| c.is_ascii_alphanumeric() || "ÄÖÜäöüß".contains(*c))
        {
            return false;
        }
        let mut offset = 0;
        let mut count = 0;
        while offset + 40 <= self.buf.len() {
            if &self.buf[offset..offset + 40] == probe {
                count += 1;
                offset += 40;
            } else {
                offset += 1;
            }
            if count >= 3 {
                self.tripped = true;
                return true;
            }
        }
        false
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_preserves_bytes_and_rejects_incomplete_final_scalars() {
        let text = "\u{feff}Grüße 👋 <think>literal evidence</think>";
        for split in 0..=text.len() {
            let mut decoder = Utf8Decoder::default();
            let mut out = decoder.decode(&text.as_bytes()[..split], false).unwrap();
            out.push_str(&decoder.decode(&text.as_bytes()[split..], false).unwrap());
            out.push_str(&decoder.decode(&[], true).unwrap());
            assert_eq!(out, text);
        }
        for bytes in [&b"\xf0\x9f"[..], &b"\xc3"[..], &b"\xe2\x82"[..]] {
            let mut decoder = Utf8Decoder::default();
            assert_eq!(decoder.decode(bytes, false).unwrap(), "");
            assert!(decoder.decode(&[], true).is_err());
        }
        assert!(Utf8Decoder::default().decode(b"\xff", false).is_err());
    }
    #[test]
    fn thinking_never_crosses_split_boundaries() {
        let text = "Grüße <think>private hidden</think>Berlin 👋";
        for (split, _) in text.char_indices() {
            let mut f = ThinkFilter::default();
            let mut out = f.feed(&text[..split]);
            out.push_str(&f.feed(&text[split..]));
            out.push_str(&f.finish());
            assert_eq!(out, "Grüße Berlin 👋");
        }
        let mut f = ThinkFilter::default();
        assert_eq!(f.feed("Answer <think>private"), "Answer ");
        assert_eq!(f.finish(), "");
    }
    #[test]
    fn repeating_prose_aborts_but_whitespace_does_not() {
        let mut f = LoopDetector::default();
        assert!(!f.feed(&" ".repeat(200)));
        assert!(f.feed(&"This is a looping answer with no progress. ".repeat(5)));
    }
}
