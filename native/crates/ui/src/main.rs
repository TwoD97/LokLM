use leptos::prelude::*;
use serde::Serialize;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{JsFuture, spawn_local};

#[wasm_bindgen]
unsafe extern "C" {
    #[wasm_bindgen(js_namespace=["window","__TAURI__","core"],js_name=invoke)]
    fn invoke(command: &str, args: JsValue) -> js_sys::Promise;
    #[wasm_bindgen(js_namespace=["window","__TAURI__","core"],js_name=Channel)]
    type TauriChannel;
    #[wasm_bindgen(constructor,js_namespace=["window","__TAURI__","core"],js_class=Channel)]
    fn new() -> TauriChannel;
    #[wasm_bindgen(method,setter,js_name=onmessage)]
    fn set_onmessage(this: &TauriChannel, callback: &JsValue);
}
thread_local! {static EMPTY_STREAM:Closure<dyn FnMut(JsValue)>=Closure::new(|_|{});}
async fn request_stream(
    input: Value,
    callback: impl FnMut(JsValue) + 'static,
) -> Result<Value, String> {
    let args = json!({"input":input})
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|_| "Invalid request")?;
    let channel = TauriChannel::new();
    let handler = Closure::<dyn FnMut(JsValue)>::new(callback);
    channel.set_onmessage(handler.as_ref());
    let object = js_sys::Reflect::get(&args, &JsValue::from_str("input"))
        .map_err(|_| "Invalid stream request")?;
    js_sys::Reflect::set(&object, &JsValue::from_str("stream"), channel.as_ref())
        .map_err(|_| "Invalid channel")?;
    let reply = JsFuture::from(invoke("dispatch", args))
        .await
        .map_err(|e| e.as_string().unwrap_or("Answer failed".into()));
    // Keep the Rust closure alive until the IPC channel has finished.
    EMPTY_STREAM.with(|empty| channel.set_onmessage(empty.as_ref()));
    drop(handler);
    serde_wasm_bindgen::from_value(reply?).map_err(|_| "Invalid answer response".into())
}
async fn request(input: Value) -> Result<Value, String> {
    let args = json!({"input":input})
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|_| "Invalid request")?;
    let reply = JsFuture::from(invoke("dispatch", args))
        .await
        .map_err(|e| e.as_string().unwrap_or("Operation failed".into()))?;
    serde_wasm_bindgen::from_value(reply).map_err(|_| "Invalid response".into())
}
#[derive(Clone, Copy)]
struct Ui {
    status: RwSignal<Value>,
    error: RwSignal<String>,
    busy: RwSignal<bool>,
    docs: RwSignal<Vec<Value>>,
    hits: RwSignal<Vec<Value>>,
    source: RwSignal<Value>,
    recovery: RwSignal<String>,
    generation: RwSignal<u64>,
    message: RwSignal<String>,
    answer: RwSignal<String>,
    answering: RwSignal<bool>,
}
impl Ui {
    fn clear(self) {
        self.docs.set(vec![]);
        self.hits.set(vec![]);
        self.source.set(Value::Null);
        self.recovery.set(String::new());
        self.message.set(String::new());
        self.answer.set(String::new());
        self.answering.set(false);
    }
    fn run(self, input: Value) {
        let generation = self.generation.get_untracked();
        self.busy.set(true);
        self.error.set(String::new());
        let asking = input["action"] == "ask";
        if asking {
            self.answer.set(String::new());
            self.hits.set(vec![]);
            self.source.set(Value::Null);
            self.answering.set(true);
        }
        spawn_local(async move {
            let result = if asking {
                request_stream(input, move |part| {
                    if self.generation.get_untracked() == generation
                        && self.answering.get_untracked()
                    {
                        if let Some(part) = part.as_string() {
                            self.answer.update(|s| s.push_str(&part));
                        }
                    }
                })
                .await
            } else {
                request(input).await
            };
            if self.generation.get_untracked() != generation {
                return;
            }
            self.busy.set(false);
            if asking {
                self.answering.set(false);
            }
            match result {
                Err(e) => {
                    self.error.set(e);
                    if asking {
                        self.answer.set(String::new());
                    }
                }
                Ok(value) => {
                    if value.get("registered").is_some() {
                        self.status.set(value.clone());
                    }
                    if let Some(s) = value.get("status") {
                        self.status.set(s.clone());
                    }
                    if let Some(d) = value["documents"].as_array() {
                        self.docs.set(d.clone());
                    }
                    if let Some(h) = value["hits"].as_array() {
                        self.hits.set(h.clone());
                        self.source.set(Value::Null);
                        self.message.set(
                            if h.is_empty() {
                                "No matching sources. Try another word."
                            } else {
                                "Matching source passages — open a citation to verify."
                            }
                            .into(),
                        );
                    }
                    if let Some(s) = value.get("source") {
                        self.source.set(s.clone());
                    }
                    if let Some(r) = value["recovery"].as_str() {
                        self.recovery.set(r.into());
                    }
                    if let Some(answer) = value["answer"].as_str() {
                        self.answer.set(answer.into());
                        self.message.set(
                            "Model answer — verify its claims against the linked sources.".into(),
                        );
                    }
                    if let Some(message) = value["message"].as_str() {
                        self.message.set(message.into());
                    }
                }
            }
        });
    }
    fn lock(self) {
        self.generation.update(|n| *n += 1);
        self.clear();
        self.status.update(|s| s["unlocked"] = json!(false));
        self.busy.set(false);
        self.run(json!({"action":"lock"}));
    }
}
fn answer_view(answer: String, hits: Vec<Value>, ui: Ui) -> impl IntoView {
    let mut parts = Vec::new();
    let mut tail = answer.as_str();
    while let Some(start) = tail.find("[doc:") {
        parts.push(view! {<span>{tail[..start].to_string()}</span>}.into_any());
        tail = &tail[start..];
        let Some(end) = tail.find(']') else {
            break;
        };
        let marker = tail[..=end].to_string();
        if let Some(hit) = hits
            .iter()
            .find(|h| format!("[doc:{}, chunk:{}]", h["document_id"], h["chunk_id"]) == marker)
        {
            let id = hit["chunk_id"].as_i64().unwrap_or(0);
            let workspace = ui.status.get_untracked()["workspace"].as_u64().unwrap_or(0);
            parts.push(view!{<button class="citation" on:click=move|_|ui.run(json!({"action":"source","chunk_id":id,"workspace":workspace}))>{marker}</button>}.into_any());
        } else {
            parts.push(view! {<span>{marker}</span>}.into_any());
        }
        tail = &tail[end + 1..];
    }
    parts.push(view! {<span>{tail.to_string()}</span>}.into_any());
    parts.collect_view()
}
#[component]
fn App() -> impl IntoView {
    let ui = Ui {
        status: RwSignal::new(json!({"registered":true,"unlocked":false,"workspaces":[]})),
        error: RwSignal::new(String::new()),
        busy: RwSignal::new(false),
        docs: RwSignal::new(vec![]),
        hits: RwSignal::new(vec![]),
        source: RwSignal::new(Value::Null),
        recovery: RwSignal::new(String::new()),
        generation: RwSignal::new(0),
        message: RwSignal::new(String::new()),
        answer: RwSignal::new(String::new()),
        answering: RwSignal::new(false),
    };
    let name = RwSignal::new(String::new());
    let password = RwSignal::new(String::new());
    let workspace = RwSignal::new(String::new());
    let query = RwSignal::new(String::new());
    let language = RwSignal::new("en".to_string());
    let recovering = RwSignal::new(false);
    let phrase = RwSignal::new(String::new());
    ui.run(json!({"action":"status"}));
    // Poll only lock state. Responses cannot re-open the view after an explicit
    // lock; epochs/generation retire all outstanding UI work.
    gloo_timers::callback::Interval::new(2000, move || {
        if !ui.busy.get_untracked() && ui.status.get_untracked()["unlocked"] == true {
            let generation = ui.generation.get_untracked();
            spawn_local(async move {
                if let Ok(s) = request(json!({"action":"status"})).await {
                    if generation == ui.generation.get_untracked() && s["unlocked"] != true {
                        ui.generation.update(|n| *n += 1);
                        ui.clear();
                        ui.status.set(s);
                    }
                }
            });
        }
    })
    .forget();
    let authenticate = move |_| {
        let secret = password.get_untracked();
        password.set(String::new());
        if recovering.get_untracked() {
            let words = phrase.get_untracked();
            phrase.set(String::new());
            recovering.set(false);
            ui.run(json!({"action":"recover","phrase":words,"password":secret}));
        } else if ui.status.get_untracked()["registered"] == true {
            ui.run(json!({"action":"unlock","password":secret}));
        } else {
            ui.run(json!({"action":"register","name":name.get_untracked(),"password":secret}));
        }
    };
    view! {
        <Show when=move||ui.status.get()["unlocked"]==true fallback=move||view!{
            <main class="auth">
                <div class="brand">"Lok"<span>"LM"</span></div>
                <div class="eyebrow" style="margin-top:10px">"Native preview"</div>
                <h1>{move||if ui.status.get()["registered"]==true{"Unlock your workspace"}else{"Your knowledge, kept local"}}</h1>
                <p class="muted">"This preview uses a separate encrypted vault. Your existing LokLM data stays in the original application."</p>
                <Show when=move||ui.status.get()["registered"]!=true>
                    <label for="name">"Display name"</label><input id="name" prop:value=move||name.get() on:input=move|e|name.set(event_target_value(&e))/>
                </Show>
                <Show when=move||recovering.get()><label for="recovery">"Recovery phrase"</label><input id="recovery" type="password" autocomplete="off" prop:value=move||phrase.get() on:input=move|e|phrase.set(event_target_value(&e))/></Show>
                <label for="password">{move||if recovering.get(){"New password"}else{"Password"}}</label><input id="password" type="password" autocomplete="current-password" prop:value=move||password.get() on:input=move|e|password.set(event_target_value(&e))/>
                <p class="muted">"At least 10 characters; include 3 of uppercase, lowercase, numbers and symbols."</p>
                <Show when=move||!ui.error.get().is_empty()><div class="error" role="alert">{move||ui.error.get()}</div></Show>
                <button class="primary" disabled=move||ui.busy.get() on:click=authenticate>{move||if ui.busy.get(){"Opening…"}else if recovering.get(){"Reset password"}else if ui.status.get()["registered"]==true{"Unlock"}else{"Create encrypted vault"}}</button>
                <Show when=move||ui.status.get()["registered"]==true><button on:click=move|_|{recovering.update(|v|*v=!*v);password.set(String::new());phrase.set(String::new());}>{move||if recovering.get(){"Back to unlock"}else{"Recover with saved phrase"}}</button></Show>
            </main>
        }>
            <div class="layout">
                <aside class="sidebar">
                    <div class="brand">"Lok"<span>"LM"</span></div>
                    <div class="eyebrow">"Workspaces"</div>
                    <select aria-label="Workspace" disabled=move||ui.busy.get() prop:value=move||ui.status.get()["workspace"].as_u64().map(|n|n.to_string()).unwrap_or_default() on:change=move|e|{
                        if let Ok(id)=event_target_value(&e).parse::<u64>(){ui.generation.update(|n|*n+=1);ui.clear();ui.run(json!({"action":"select_workspace","id":id}));}
                    }>
                        <option value="">"Select workspace"</option>
                        {move||ui.status.get()["workspaces"].as_array().cloned().unwrap_or_default().into_iter().map(|w|view!{<option value=w["id"].to_string()>{w["name"].as_str().unwrap_or("").to_string()}</option>}).collect_view()}
                    </select>
                    <input aria-label="New workspace name" placeholder="New workspace name" prop:value=move||workspace.get() on:input=move|e|workspace.set(event_target_value(&e))/>
                    <button disabled=move||ui.busy.get() on:click=move|_|{ui.run(json!({"action":"create_workspace","name":workspace.get_untracked()}));workspace.set(String::new());}>"Create workspace"</button>
                    <div class="documents"><div class="eyebrow">"Documents"</div>
                        {move||ui.docs.get().into_iter().map(|d|view!{<div class="doc"><span>{d["title"].as_str().unwrap_or("").to_string()}</span><span class="muted">{d["chunk_count"].to_string()}</span></div>}).collect_view()}
                    </div>
                    <footer><button on:click=move|_|{password.set(String::new());query.set(String::new());ui.lock();}>"Lock vault"</button><p class="muted">"Encrypted locally · No cloud connection"</p></footer>
                </aside>
                <main class="main">
                    <div class="top"><div><div class="eyebrow">"Your private library"</div><h1>"Find it. Read the source."</h1></div><span class="badge">"Local · Rust"</span></div>
                    <p class="muted">"Native preview · Text and Markdown, local CPU models and source-linked answers. Advanced answer checks, PDF/OCR and voice are still being migrated."</p>
                    <Show when=move||!ui.recovery.get().is_empty()>
                        <div class="recovery"><strong>"Save your recovery phrase privately"</strong><pre>{move||ui.recovery.get()}</pre><p class="muted">"Use this phrase to reset your password without losing documents. Keep it private and out of chat."</p><button on:click=move|_|ui.recovery.set(String::new())>"I saved the phrase"</button></div>
                    </Show>
                    <div class="search"><input aria-label="Search documents" placeholder="Ask for a topic, name or exact phrase…" prop:value=move||query.get() on:input=move|e|query.set(event_target_value(&e))/><button class="primary" disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"search","query":query.get_untracked()}))>"Search"</button></div>
                    <div class="toolbar"><button disabled=move||ui.busy.get()||ui.status.get()["workspace"].is_null() on:click=move|_|ui.run(json!({"action":"import"}))>"Import document"</button><button on:click=move|_|{ui.generation.update(|n|*n+=1);ui.busy.set(false);ui.answer.set(String::new());ui.answering.set(false);ui.message.set("Cancelled".into());spawn_local(async{let _=request(json!({"action":"cancel"})).await;});}>"Cancel"</button></div>
                    <details class="models"><summary>"Local models · CPU, 2 threads"</summary><p class="muted">"Select the existing LokLM GGUF files. Loading uses additional RAM. Models unload when this vault locks."</p><div class="toolbar">
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"load_model","kind":"generator"}))>"Load Qwen3.5-4B"</button>
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"load_model","kind":"bge"}))>"Load BGE-M3"</button>
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"load_model","kind":"qwen_embedding"}))>"Load Qwen3 embedding"</button>
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"load_model","kind":"reranker"}))>"Load BGE reranker"</button>
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"index"}))>"Index workspace"</button>
                        <button disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"unload_models"}))>"Unload preview models"</button>
                    </div></details>
                    <div class="toolbar"><select aria-label="Answer language" style="width:150px" prop:value=move||language.get() on:change=move|e|language.set(event_target_value(&e))><option value="en">"English"</option><option value="de">"Deutsch"</option></select><button class="primary" disabled=move||ui.busy.get() on:click=move|_|ui.run(json!({"action":"ask","query":query.get_untracked(),"language":language.get_untracked()}))>"Ask with sources"</button></div>
                    <Show when=move||!ui.error.get().is_empty()><div class="error" role="alert">{move||ui.error.get()}</div></Show>
                    <p class="status" role="status">{move||if ui.busy.get(){"Working…".into()}else{ui.message.get()}}</p>
                    <Show when=move||!ui.answer.get().is_empty()><section class="panel answer"><h2>{move||if ui.answering.get(){"Provisional answer · checking citations"}else{"Model answer"}}</h2><div class="source">{move||answer_view(ui.answer.get(),ui.hits.get(),ui)}</div></section></Show>
                    <div class="columns"><section class="panel"><h2>"Source passages"</h2>
                        <Show when=move||!ui.hits.get().is_empty() fallback=||view!{<div class="empty">"Your sources will appear here."<br/>"Import a document and search its contents."</div>}>
                            {move||ui.hits.get().into_iter().enumerate().map(|(i,h)|{let id=h["chunk_id"].as_i64().unwrap_or(0);let workspace=ui.status.get_untracked()["workspace"].as_u64().unwrap_or(0);let title=format!("[{}] {}",i+1,h["title"].as_str().unwrap_or(""));let text=h["text"].as_str().unwrap_or("").chars().take(350).collect::<String>();view!{<button class="hit" on:click=move|_|ui.run(json!({"action":"source","chunk_id":id,"workspace":workspace}))><strong>{title}</strong><p>{text}</p></button>}}).collect_view()}
                        </Show>
                    </section><section class="panel"><h2>"Verify the source"</h2>
                        <Show when=move||!ui.source.get().is_null() fallback=||view!{<div class="empty">"Open a citation to read the indexed passage."<br/>"Document text is displayed as untrusted plain text."</div>}>
                            <div class="filename">{move||ui.source.get()["source_path"].as_str().unwrap_or("").to_string()}</div>
                            <pre class="source">{move||ui.source.get()["text"].as_str().unwrap_or("").to_string()}</pre>
                        </Show>
                    </section></div>
                </main>
            </div>
        </Show>
    }
}
fn main() {
    leptos::mount::mount_to_body(App);
}
