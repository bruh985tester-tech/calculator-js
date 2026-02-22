const log = document.getElementById("log");
const runBtn = document.getElementById("run");
const stopBtn = document.getElementById("stop");
const confirmUI = document.getElementById("confirm-ui");
const btnYes = document.getElementById("btn-yes");
const btnNo = document.getElementById("btn-no");
const micBtn = document.getElementById("mic-btn");
const promptBox = document.getElementById("prompt");

let keepRunning = false;
let actionHistory = [];

// --- SPEECH TO TEXT (Native) ---
let recognition;
if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => { micBtn.classList.add("listening"); };
    recognition.onend = () => { micBtn.classList.remove("listening"); };
    
    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        promptBox.value += (promptBox.value ? " " : "") + text;
    };

    micBtn.onclick = () => {
        if (micBtn.classList.contains("listening")) recognition.stop();
        else recognition.start();
    };
} else {
    micBtn.style.display = "none"; // Hide if not supported
}

function write(msg, type = "msg") {
    const div = document.createElement("div");
    div.innerHTML = msg; 
    div.className = "msg " + type;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// --- 1. DOM SCANNER ---
function DOMScanner(showOverlays) {
    document.querySelectorAll(".nano-overlay").forEach(el => el.remove());

    function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.nodeName.toLowerCase();
            if (current.parentElement) {
                let siblings = Array.from(current.parentElement.children);
                if (siblings.length > 1) {
                    let index = siblings.indexOf(current) + 1;
                    selector += ':nth-child(' + index + ')';
                }
            }
            path.unshift(selector);
            current = current.parentElement;
        }
        return path.join(' > ');
    }

    function getAllElements(root) {
        let els = [];
        if (!root) return els;
        const nodes = root.querySelectorAll("input, button, a, textarea, select, [role='button'], [role='checkbox'], label");
        els = Array.from(nodes);
        const allNodes = root.querySelectorAll('*');
        allNodes.forEach(node => {
            if (node.shadowRoot) {
                els = els.concat(getAllElements(node.shadowRoot));
            }
        });
        return els;
    }

    const allTargets = getAllElements(document);
    
    const visibleTargets = allTargets.filter(el => {
        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top <= window.innerHeight;
        const hasText = (el.innerText && el.innerText.trim().length > 1) || el.value || el.getAttribute("aria-label");
        return isVisible && hasText;
    });

    return visibleTargets.slice(0, 80).map((el, index) => {
        let text = (el.innerText || el.value || "").substring(0, 50).replace(/\n/g, " ").trim();
        let label = (el.getAttribute("aria-label") || "").substring(0, 30);
        
        if (showOverlays) {
            const rect = el.getBoundingClientRect();
            const div = document.createElement("div");
            div.className = "nano-overlay";
            Object.assign(div.style, {
                position: "fixed", left: rect.left + "px", top: rect.top + "px",
                width: rect.width + "px", height: rect.height + "px",
                border: "2px solid #2563eb", backgroundColor: "rgba(37, 99, 235, 0.05)",
                zIndex: "9999999", pointerEvents: "none", borderRadius: "4px"
            });
            const badge = document.createElement("div");
            badge.innerText = index;
            Object.assign(badge.style, {
                position: "absolute", top: "-18px", left: "0",
                background: "#2563eb", color: "white", fontSize: "12px",
                padding: "2px 6px", borderRadius: "4px", fontWeight: "bold"
            });
            div.appendChild(badge);
            document.body.appendChild(div);
        }

        return {
            index: index,
            tag: el.tagName,
            text: text || label || "[No Text]",
            sel: getUniqueSelector(el),
            isSensitive: /buy|pay|checkout|delete|confirm/i.test(text || label)
        };
    });
}

// --- 2. EXTRACTOR ---
function extractData() {
    const results = [];
    const nodes = document.querySelectorAll("*");
    nodes.forEach(el => {
        const txt = el.innerText;
        if (txt && (txt.includes('$') || txt.includes('₹')) && txt.length < 100) {
            let parent = el.parentElement;
            while (parent && parent.innerText.length < 300) parent = parent.parentElement;
            if (parent && !results.includes(parent.innerText)) {
                results.push(parent.innerText.split('\n').slice(0, 2).join(" - "));
            }
        }
    });
    return [...new Set(results)].slice(0, 8);
}

// --- 3. SMART WAITER ---
function smartWait() {
    return new Promise(resolve => {
        let lastMutations = 0;
        const observer = new MutationObserver(list => lastMutations += list.length);
        observer.observe(document.body, { childList: true, subtree: true });
        let checks = 0;
        const interval = setInterval(() => {
            checks++;
            if ((lastMutations < 2 && checks > 1) || checks > 8) {
                clearInterval(interval);
                observer.disconnect();
                resolve();
            }
            lastMutations = 0;
        }, 500);
    });
}

// --- 4. BRAIN (Multi-Model Support) ---
async function callLLM(goal, elements, history, url, apiKey, modelName) {
    const isDeepSeek = modelName.includes("deepseek");
    const endpoint = isDeepSeek 
        ? "https://api.deepseek.com/chat/completions"
        : `https://generativelanguage.googleapis.com/v1beta/${modelName.startsWith("models/")?modelName:"models/"+modelName}:generateContent?key=${apiKey}`;

    const systemPrompt = `
    You are NanoAgent.
    GOAL: "${goal}"
    URL: "${url}"
    HISTORY: ${history.join(" -> ")}
    UI ELEMENTS:
    ${JSON.stringify(elements.map(e => ({ i: e.index, t: e.tag, txt: e.text, sensitive: e.isSensitive })))}

    INSTRUCTIONS:
    1. Select the Best Action.
    2. Use "extract" if user wants data.
    3. Use "scroll" if target not found.
    4. Use "finish" if done.

    RESPONSE FORMAT (JSON ONLY):
    {
        "reasoning": "thought process",
        "action": "click" | "type" | "scroll" | "extract" | "finish",
        "target_index": number,
        "value": "string"
    }
    `;

    try {
        let data;
        if (isDeepSeek) {
            const req = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [{ role: "system", content: "You output JSON only." }, { role: "user", content: systemPrompt }],
                    response_format: { type: "json_object" }
                })
            });
            data = await req.json();
            return JSON.parse(data.choices[0].message.content);
        } else {
            const req = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            data = await req.json();
            return JSON.parse(data.candidates[0].content.parts[0].text);
        }
    } catch (e) {
        throw new Error("API Error: " + e.message);
    }
}

// --- 5. EXECUTION LOOP ---
runBtn.onclick = async () => {
    keepRunning = true;
    actionHistory = [];
    runBtn.style.display = "none";
    stopBtn.style.display = "inline-block";
    log.innerHTML = "";
    
    const goal = promptBox.value;
    const showBoxes = document.getElementById("show-boxes").checked;
    
    // FETCH GRANULAR SETTINGS
    const settings = await chrome.storage.sync.get(['apiKey', 'deepseekKey', 'plannerModel', 'navigatorModel']);
    
    // Choose which model to use. 
    // For simplicity in this single-loop architecture, we primarily use the "Planner" model for logic.
    // In a future split-architecture, we would use Navigator for clicking.
    const selectedModel = settings.plannerModel || "gemini-1.5-flash"; 
    
    const activeKey = selectedModel.includes('deepseek') ? settings.deepseekKey : settings.apiKey;
    
    if (!activeKey) {
        write("❌ Error: Missing API Key for " + selectedModel, "error");
        keepRunning = false;
        return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    write(`🎯 Goal: "${goal}"`, "user");
    write(`🧠 Using Planner: ${selectedModel}`, "debug");

    for (let step = 1; step <= 20; step++) {
        if (!keepRunning) break;
        write(`🔄 Step ${step}...`, "debug");

        try {
            const scan = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: DOMScanner, args: [showBoxes] });
            const elements = scan[0].result;

            const plan = await callLLM(goal, elements, actionHistory, tab.url, activeKey, selectedModel);
            write(`🤖 ${plan.reasoning}`, "ai");
            
            actionHistory.push(plan.action);

            if (plan.action === "finish") {
                write("✅ Task Complete.", "ai");
                break;
            }

            if (plan.action === "extract") {
                write("📊 Extracting Data...", "action");
                const data = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractData });
                data[0].result.forEach(d => write(`• ${d}`, "msg"));
                break;
            }

            if (plan.action === "scroll") {
                write("⬇️ Scrolling...", "action");
                await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollBy({top: 600, behavior:'smooth'}) });
                await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: smartWait });
                continue;
            }

            if (typeof plan.target_index === "number") {
                const target = elements.find(e => e.index === plan.target_index);
                if (target) {
                    if (target.isSensitive || plan.reasoning.toLowerCase().includes("buy")) {
                        write("⚠️ High Stakes. Paused.", "error");
                        confirmUI.style.display = "block";
                        await new Promise(resolve => {
                            btnYes.onclick = () => { confirmUI.style.display="none"; resolve(true); };
                            btnNo.onclick = () => { confirmUI.style.display="none"; resolve(false); keepRunning=false; };
                        });
                        if (!keepRunning) break;
                    }

                    write(`🔧 ${plan.action.toUpperCase()}: ${target.text}`, "action");
                    
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: (sel, act, val) => {
                            const el = document.querySelector(sel);
                            if (el) {
                                el.focus();
                                if (act === "type") {
                                    el.value = val;
                                    el.dispatchEvent(new Event('input', {bubbles:true}));
                                    el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));
                                } else { el.click(); }
                            }
                        },
                        args: [target.sel, plan.action, plan.value || ""]
                    });
                    
                    write("⏳ Waiting...", "debug");
                    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: smartWait });
                }
            }

        } catch (e) {
            write("❌ Error: " + e.message, "error");
            break;
        }
    }
    stopBtn.style.display = "none";
    runBtn.style.display = "inline-block";
};

stopBtn.onclick = () => { keepRunning = false; write("🛑 Stopped."); };
document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
