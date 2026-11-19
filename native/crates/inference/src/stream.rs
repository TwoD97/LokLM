//! Streaming output guards. Never publish a partial thinking delimiter.
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
