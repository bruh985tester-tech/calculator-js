const status = document.getElementById("status");

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['apiKey', 'deepseekKey', 'plannerModel', 'navigatorModel'], (items) => {
        if (items.apiKey) document.getElementById('apiKey').value = items.apiKey;
        if (items.deepseekKey) document.getElementById('deepseekKey').value = items.deepseekKey;
        
        // Restore Planner Selection
        if (items.plannerModel) {
            addOption('plannerModel', items.plannerModel, true);
        }
        // Restore Navigator Selection
        if (items.navigatorModel) {
            addOption('navigatorModel', items.navigatorModel, true);
        }
    });
});

function addOption(selectId, value, selected = false) {
    const select = document.getElementById(selectId);
    // Check if exists
    for(let i=0; i<select.options.length; i++) {
        if(select.options[i].value === value) {
            if(selected) select.selectedIndex = i;
            return;
        }
    }
    const option = document.createElement("option");
    option.value = value;
    option.text = value + (selected ? " (Saved)" : "");
    if(selected) option.selected = true;
    select.add(option);
}

document.getElementById('fetchModels').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value;
    if (!apiKey) { alert("Enter Google API Key first"); return; }
    
    status.textContent = "Fetching...";
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        
        if (data.error) throw new Error(data.error.message);

        // Populate both dropdowns
        ['plannerModel', 'navigatorModel'].forEach(id => {
            const select = document.getElementById(id);
            // Keep DeepSeek option
            select.innerHTML = '<option value="deepseek-chat">DeepSeek V3 (Manual)</option>';
            
            data.models.filter(m => m.supportedGenerationMethods?.includes("generateContent")).forEach(m => {
                const option = document.createElement("option");
                option.value = m.name.replace("models/", ""); 
                option.text = m.displayName + " (" + m.name + ")";
                select.appendChild(option);
            });
        });
        
        status.textContent = "Loaded!";
    } catch (e) {
        status.textContent = "Error: " + e.message;
    }
});

document.getElementById('save').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value;
    const deepseekKey = document.getElementById('deepseekKey').value;
    const plannerModel = document.getElementById('plannerModel').value;
    const navigatorModel = document.getElementById('navigatorModel').value;
    
    chrome.storage.sync.set({ apiKey, deepseekKey, plannerModel, navigatorModel }, () => {
        status.textContent = "Settings Saved!";
        setTimeout(() => status.textContent = "", 2000);
    });
});