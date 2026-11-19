//! Original production checked-context construction. This does not enable a
//! route or run inference. Keep a bundle intact after the final context budget
//! check; decline structured generation if its comparison plan is unavailable.
use crate::{
    comparison_answer::{ComparisonMode, ComparisonPassage, ComparisonPlan},
    qa::{self, CitationOutput, Language, Passage},
    source_calculations,
    source_quantities::{self, QuantityPassage},
};
pub fn system_prompt(language: Language, mode: ComparisonMode) -> &'static str {
    match (language, mode) {
        (Language::En, ComparisonMode::Full) => include_str!("qa_prompts/checked-en-full.txt"),
        (Language::De, ComparisonMode::Full) => include_str!("qa_prompts/checked-de-full.txt"),
        (Language::En, ComparisonMode::Summary) => {
            include_str!("qa_prompts/checked-en-summary.txt")
        }
        (Language::De, ComparisonMode::Summary) => {
            include_str!("qa_prompts/checked-de-summary.txt")
        }
    }
}
fn catalog(hits: &[Passage], pinned: &[Passage]) -> Vec<ComparisonPassage> {
    pinned
        .iter()
        .chain(hits)
        .map(|s| ComparisonPassage {
            document_id: s.document_id,
            chunk_id: s.chunk_id,
            document_title: s.document_title.clone(),
            text: s.text.clone(),
        })
        .collect()
}
pub fn build_prompt(
    question: &str,
    hits: &[Passage],
    language: Language,
    pinned: &[Passage],
    mode: ComparisonMode,
) -> String {
    let fed = catalog(hits, pinned);
    let arithmetic = [
        source_quantities::annotate(
            &fed.iter()
                .map(|s| QuantityPassage {
                    document_id: s.document_id,
                    chunk_id: s.chunk_id,
                    text: s.text.clone(),
                })
                .collect::<Vec<_>>(),
        )
        .annotation,
        source_calculations::annotate(question, &fed).annotation,
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");
    let output = if mode == ComparisonMode::Summary {
        CitationOutput::StructuredSummary
    } else {
        CitationOutput::StructuredSources
    };
    let mut prompt =
        qa::build_prompt_with_output(question, hits, &[], language, pinned, None, output);
    if !arithmetic.is_empty() {
        prompt.push_str("\n\nDerived arithmetic checks:\n");
        prompt.push_str(&arithmetic);
    }
    if mode == ComparisonMode::Summary {
        prompt.push_str(match language {
            Language::De => "\n\nGrenze für die vollständige Anzeige von summary: 512 Zeichen einschließlich Quellenaussagen, dokumentarischer Einordnung und Quellenverweisen. Alle Originalfragmente müssen exakt aus der angegebenen Passage stammen; keine Übersetzung oder freie Antwortprosa.",
            Language::En => "\n\nLimit for the complete rendered summary: 512 characters including reported alternatives, documentary framing and citations. Every original fragment must match its supplied passage exactly; no translation or unrestricted answer prose.",
        });
    }
    prompt
}
pub struct ContextBundle {
    plan: Option<ComparisonPlan>,
    prompt: String,
    system_prompt: &'static str,
}
impl ContextBundle {
    pub fn new(question: &str, hits: &[Passage], language: Language, pinned: &[Passage]) -> Self {
        let plan = ComparisonPlan::new(question, &catalog(hits, pinned));
        let mode = plan
            .as_ref()
            .map_or(ComparisonMode::Full, ComparisonPlan::comparison_mode);
        Self {
            plan,
            prompt: build_prompt(question, hits, language, pinned, mode),
            system_prompt: system_prompt(language, mode),
        }
    }
    pub fn comparison_plan(&self) -> Option<&ComparisonPlan> {
        self.plan.as_ref()
    }
    pub fn prompt(&self) -> &str {
        &self.prompt
    }
    pub fn system_prompt(&self) -> &str {
        self.system_prompt
    }
}
pub fn answer_char_limit(max_tokens: f64) -> usize {
    (if max_tokens.is_finite() {
        max_tokens * 6.0
    } else {
        0.0
    })
    .ceil()
    .clamp(1.0, 32_000.0) as usize
}
