const log = document.getElementById("log");

function write(msg, type = "") {
    const div = document.createElement("div");
    div.textContent = msg;
    if (type) div.className = type;
    div.style.borderBottom = "1px solid #eee";
    div.style.padding = "4px";
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// --- 1. SCANNER ---
function DOMScanner() {
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

    const targets = document.querySelectorAll("input, button, a[href], textarea, [role='button']");
    return Array.from(targets).slice(0, 50).map(el => {
        let text = (el.innerText || "").substring(0, 30).replace(/\n/g, " ");
        let placeholder = (el.placeholder || "").substring(0, 30);
        return {
            tag: el.tagName,
            txt: text || placeholder || "[No Text]",
            sel: getUniqueSelector(el)
        };
    });
}

// --- 2. BRAIN ---
async function callGemini(goal, domElements, apiKey, modelName) {
    // Clean the model name just in case
    // If the model name already has 'models/', keep it. If not, add it.
    let fullModelName = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
    
    // We use the 'v1' endpoint which is more stable than 'v1beta'
    const url = `https://generativelanguage.googleapis.com/v1/models/${fullModelName.replace("models/", "")}:generateContent?key=${apiKey}`;

    const prompt = `
    GOAL: "${goal}"
    ELEMENTS: ${JSON.stringify(domElements)}
    
    Task: Return JSON with best element to interact with.
    Format: {"reasoning": "string", "selector": "string", "action": "click"|"type", "value": "string"}
    `;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error.message);
        }
        
        let rawText = data.candidates[0].content.parts[0].text;
        rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(rawText);
    } catch (e) {
        throw e;
    }
}

// --- 3. LOOP ---
document.getElementById("run").onclick = async () => {
    log.innerHTML = "";
    const goal = document.getElementById("prompt").value;
    
    const { apiKey, model } = await chrome.storage.sync.get(['apiKey', 'model']);
    if (!apiKey) {
        write("âŒ No API Key. Go to Options.", "error");
        return;
    }

    // Default fallback
    const selectedModel = model || "gemini-1.5-flash";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    write(`ðŸŽ¯ Goal: "${goal}"`, "user");
    write(`âš¡ Model: ${selectedModel}`, "debug");
    write("ðŸ”„ Scanning...", "debug");

    try {
        const scanResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: DOMScanner
        });
        
        const elements = scanResults[0].result;
        write(`ðŸ‘ï¸ Sending ${elements.length} items to AI...`, "debug");

        const plan = await callGemini(goal, elements, apiKey, selectedModel);
        
        write(`ðŸ¤– Reasoning: ${plan.reasoning}`, "ai");

        if (plan.selector) {
             write(`ðŸ”§ ${plan.action} -> ${plan.selector}`, "debug");
             
             await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (selector, action, value) => {
                    const el = document.querySelector(selector);
                    if (!el) return;
                    
                    el.focus();
                    if (action === "type") {
                        el.value = value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                        const form = el.closest('form');
                        if (form) setTimeout(() => form.submit(), 200);
                    } else {
                        el.click();
                    }
                },
                args: [plan.selector, plan.action, plan.value]
            });
            write("âœ… Done.", "ai");
        } else {
             write("â” No target found.", "error");
        }

    } catch (err) {
        write("âŒ Error: " + err.message, "error");
    }
};