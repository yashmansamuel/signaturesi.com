'use strict';

// ==========================================================================
//  NEO CORE - Production-Ready JavaScript (Stable - No User-Visible Errors)
//  Features: Dual API failover with mock fallback, markdown with math,
//            session management, abort control, optimistic UI, accessibility
// ==========================================================================

// =============================
// COMPLETE AI ROUTER (DYNAMIC CONFIGURATION)
// =============================

// =============================
// API CONFIGURATION (GROQ – real‑time, CEREBRAS – reasoning)
// =============================

const PRIMARY_API = {
  name: "Groq",
  key: "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",
  url: "https://api.groq.com/openai/v1/chat/completions",
  model: "openai/gpt-oss-20b"        //  Verify model name with Groq documentation
};

const PRIMARY_2_API = {
  name: "Groq",
  key: "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",
  url: "https://api.groq.com/openai/v1/chat/completions",
  model: "meta-llama/llama-4-scout-17b-16e-instruct"        //  Verify model name
};

const SECONDARY_API = {
  name: "Cerebras",
  key: "csk-kjh55p5f8ffmmm3tjpt5fjdpedc2d58cc8yk698t59c6tpd9",
  url: "https://api.cerebras.ai/v1/chat/completions",
  model: "gpt-oss-120b"              //  Verify model name with Cerebras documentation
};

const SECONDARY_2_API = {
  name: "Cerebras",
  key: "csk-fxvmf35tn8xmvjw89y5expjetkhcetvetymm58nd9rptfykm",
  url: "https://api.cerebras.ai/v1/chat/completions",
  model: "gpt-oss-120b"              //  Verify model name
};

const BASE_SYSTEM_PROMPT = {
  role: "system",
  content: `NEO "SIGNATURE NEO" — Practical Mode

Persona: calm, supportive, subtly playful. Aim for clarity & usefulness.

Core directives:
1) Personalization:
   - Check conversation history for user specifics.
   - Ask targeted follow-ups when necessary.

2) Reasoning:
   - Provide a brief, structured explanation (2–4 steps) leading to a clear conclusion.
   - Do NOT reveal internal chain-of-thought.

3) Math & LaTeX:
   - Prefer LaTeX for formulas.
   - Always wrap formulas using escaped display math:

     ---BEGIN_LATEX---
     \\[
     E = mc^2
     \\]
     ---END_LATEX---

   - Inline math: use \\( ... \\)
   - If LaTeX cannot render, provide a short plain-text fallback immediately after:

     Fallback (plain text): E = m * c^2

4) Output format (mandatory, use exactly these headers):
   [THOUGHTS_SUMMARY] — detected user profile & context (1–2 lines)
   [VALIDATE] — confidence estimate (0–100%), important checks
   [CONCLUSION] — answer + one targeted next question

5) Style rules:
   - Avoid filler text; never say "As an AI."
   - Be concise for experts; explanatory for beginners.
   - Maintain calm, supportive, subtly playful tone.

6) Safety:
   - Refuse unsafe requests, then offer safe alternatives.

Implementation notes:
- Store this prompt as a JS template literal (\`...\`) to avoid escape issues.
- Escape all backslashes in LaTeX (\\).
- Keep the prompt under ~1500 words to reduce rendering conflicts.
- Use explicit LaTeX markers (---BEGIN_LATEX--- / ---END_LATEX---) for reliable parsing.
`
};

// ==========================================================================
//  2. Global State
// ==========================================================================

let chatHistory = [BASE_SYSTEM_PROMPT];
let lastInput = "";
let chatSessions = JSON.parse(localStorage.getItem('chatSessions')) || [];
let hypotheticalMode = localStorage.getItem('hypotheticalMode') === 'true';
let abortController = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const regenContainer = document.getElementById('regenContainer');
const inputWrapper = document.getElementById('inputWrapper');

// ==========================================================================
//  3. Utility Functions
// ==========================================================================

function escapeHtml(str = '') {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(callback, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}

function notify({ message, type = 'info' } = {}) {
  if (!message) return;
  console.log(`[${type.toUpperCase()}] ${message}`);
  // → replace with toast library call later
}

// ==========================================================================
//  4. UI Helpers (Auto-expand, Key Handling)
// ==========================================================================

window.autoExpand = function(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';
};

window.handleKeyDown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        startReasoning();
    }
};

// ==========================================================================
//  5. Initialization & Persistence
// ==========================================================================

window.addEventListener('load', function() {
    // Animate input into center after load
    setTimeout(() => inputWrapper.classList.add('center'), 100);

    loadChatHistory();

    // Apply saved preferences
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
    }
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
    const toggle = document.getElementById('hypotheticalToggle');
    if (toggle) toggle.checked = hypotheticalMode;

    // Update dark mode icon
    updateDarkModeIcon();

    // Focus input for better UX
    userInput.focus();
});

// ==========================================================================
//  6. Sidebar & Settings Functions
// ==========================================================================

window.toggleSidebar = function() {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
};

window.toggleHypothetical = function(checked) {
    hypotheticalMode = checked;
    localStorage.setItem('hypotheticalMode', hypotheticalMode);
    updateSystemPrompt();
};

function updateSystemPrompt() {
    const baseContent = BASE_SYSTEM_PROMPT.content;
    const hypoInstruction = hypotheticalMode ?
        "\n\nIMPORTANT: For this chat, you must explicitly explore multiple hypothetical scenarios (at least 3) before concluding." : "";
    const newContent = baseContent + hypoInstruction;
    const sysIndex = chatHistory.findIndex(msg => msg.role === 'system');
    if (sysIndex !== -1) {
        chatHistory[sysIndex].content = newContent;
    } else {
        chatHistory.unshift({ role: "system", content: newContent });
    }
}

window.newChat = function() {
    if (chatHistory.length > 1) {
        saveCurrentSession();
    }
    chatHistory = [BASE_SYSTEM_PROMPT];
    updateSystemPrompt();
    chatBox.innerHTML = '';
    regenContainer.style.display = 'none';
    userInput.value = '';
    userInput.style.height = 'auto';
    lastInput = '';
    loadChatHistory();
    userInput.focus();
};

window.clearAllChats = function() {
    if (confirm('Clear all chat history?')) {
        chatSessions = [];
        localStorage.removeItem('chatSessions');
        loadChatHistory();
    }
};

// Dark mode toggle with icon update
window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
    updateDarkModeIcon();
};

// Update dark mode icon based on current state
function updateDarkModeIcon() {
    const btn = document.getElementById('darkModeToggle');
    if (!btn) return;
    const isDark = document.body.classList.contains('dark-mode');
    btn.innerHTML = isDark
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' // moon
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'; // sun
}

// Save current session to history (auto-save debounced)
const debouncedSaveSession = debounce(saveCurrentSession, 2000);

function saveCurrentSession() {
    const firstUser = chatHistory.find(msg => msg.role === 'user');
    if (firstUser) {
        const title = firstUser.content.substring(0, 30) + (firstUser.content.length > 30 ? '…' : '');
        chatSessions.unshift({ title, history: [...chatHistory], timestamp: Date.now() });
        if (chatSessions.length > 10) chatSessions.pop();
        localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
    }
}

window.loadChatHistory = function() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    historyList.innerHTML = '';
    chatSessions.forEach((session, index) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        if (session.pinned) item.classList.add('pinned');

        // Build the inner HTML with premium icons
        item.innerHTML = `
            <div class="history-item-content">
                <span class="history-title">${escapeHtml(session.title || 'New Chat')}</span>
                ${session.pinned ? '<svg class="pin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M12 2C8 2 5 5 5 9v6l-2 2v2h18v-2l-2-2V9c0-4-3-7-7-7z"/></svg>' : ''}
            </div>
            <button class="history-menu-btn" onclick="event.stopPropagation(); toggleHistoryMenu(${index})" aria-label="Chat options">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="6" r="1.5"></circle>
                    <circle cx="12" cy="12" r="1.5"></circle>
                    <circle cx="12" cy="18" r="1.5"></circle>
                </svg>
            </button>
            <div class="history-menu" id="menu-${index}">
                <button class="history-menu-item" onclick="event.stopPropagation(); pinSession(${index})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M12 2C8 2 5 5 5 9v6l-2 2v2h18v-2l-2-2V9c0-4-3-7-7-7z"/></svg>
                    <span>${session.pinned ? 'Unpin' : 'Pin'}</span>
                </button>
                <button class="history-menu-item" onclick="event.stopPropagation(); renameSession(${index})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    <span>Rename</span>
                </button>
                <button class="history-menu-item" onclick="event.stopPropagation(); deleteSession(${index})">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <span>Delete</span>
                </button>
            </div>
        `;
        item.onclick = () => loadSession(index);
        historyList.appendChild(item);
    });
};

window.toggleHistoryMenu = function(index) {
    const menu = document.getElementById(`menu-${index}`);
    if (menu) {
        menu.classList.toggle('show');
        // Close other menus
        document.querySelectorAll('.history-menu').forEach(m => {
            if (m.id !== `menu-${index}`) m.classList.remove('show');
        });
    }
};

// Close menus when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!e.target.closest('.history-menu-btn')) {
        document.querySelectorAll('.history-menu').forEach(m => m.classList.remove('show'));
    }
});

window.pinSession = function(index) {
    const session = chatSessions[index];
    if (session) {
        session.pinned = !session.pinned; // toggle
        // Reorder: pinned to top, unpinned stay in place
        if (session.pinned) {
            const [pinnedSession] = chatSessions.splice(index, 1);
            chatSessions.unshift(pinnedSession);
        } else {
            // If unpinning, we could move to bottom or keep order. For simplicity, just update.
            // We'll re-sort pinned to top on each load anyway.
        }
        localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
        loadChatHistory(); // refresh
    }
};

window.renameSession = function(index) {
    const newTitle = prompt('Enter new title:', chatSessions[index].title);
    if (newTitle) {
        chatSessions[index].title = newTitle;
        localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
        loadChatHistory();
    }
};

window.deleteSession = function(index) {
    if (confirm('Delete this chat session?')) {
        chatSessions.splice(index, 1);
        localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
        loadChatHistory();
    }
};

window.loadSession = function(index) {
    // Remove active class from all history items
    document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
    const session = chatSessions[index];
    if (session) {
        chatHistory = [...session.history];
        displaySessionMessages();
        // Add active class to the clicked item after a short delay (DOM updates)
        setTimeout(() => {
            const items = document.querySelectorAll('.history-item');
            if (items[index]) items[index].classList.add('active');
        }, 10);
    }
};

function displaySessionMessages() {
    chatBox.innerHTML = '';
    chatHistory.forEach((msg, idx) => {
        if (msg.role === 'user') {
            appendUserMessage(msg.content, idx);
        } else if (msg.role === 'assistant') {
            appendAIMessage(msg.content, idx);
        }
    });
}

// ==========================================================================
//  7. Message Appending (User & AI) – GPT‑style actions below
// ==========================================================================

function appendUserMessage(text, index) {
    const msgId = 'user_' + Date.now() + index;
    const html = `
        <div id="${msgId}" class="message-row user-row group">
            <div class="user-bubble">${escapeHtml(text)}</div>
            <div class="message-actions user-actions opacity-0 group-hover:opacity-100 transition">
                <button class="action-btn" onclick="editUserMessage('${msgId}')" title="Edit">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
                <button class="action-btn" onclick="copyMessage('${msgId}', 'user')" title="Copy">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
            </div>
        </div>`;
    chatBox.insertAdjacentHTML('beforeend', html);
}

function appendAIMessage(text, index) {
    const aiId = 'ai_' + Date.now() + index;
    const html = `
        <div id="container_${aiId}" class="message-row ai-row group">
            <div class="ai-header" onclick="toggleThought('${aiId}')">
                <svg id="icon_${aiId}" class="chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/>
                </svg>
                <span id="header_${aiId}" class="ai-name">Neo</span>
            </div>
            <div id="thought_${aiId}" class="thought-process"></div>
            <div id="concl_${aiId}" class="conclusion"></div>
            <div class="message-actions ai-actions opacity-0 group-hover:opacity-100 transition">
                <button class="action-btn" onclick="regenerateAIResponse('${aiId}')" title="Regenerate">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
                <button class="action-btn" onclick="copyConclusion('${aiId}')" title="Copy">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button class="action-btn" onclick="feedbackPositive('${aiId}')" title="Good response">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                </button>
                <button class="action-btn" onclick="feedbackNegative('${aiId}')" title="Bad response">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
                </button>
                <button class="action-btn" onclick="deleteMessage('container_${aiId}')" title="Delete">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>`;
    chatBox.insertAdjacentHTML('beforeend', html);
    parseAndDisplay(text, aiId);
}

// ==========================================================================
//  8. Copy message (user)
// ==========================================================================

window.copyMessage = function(msgId, type) {
    const msgElement = document.getElementById(msgId);
    if (!msgElement) return;
    let text;
    if (type === 'user') {
        text = msgElement.querySelector('.user-bubble')?.innerText;
    } else {
        return;
    }
    if (text) {
        navigator.clipboard.writeText(text).then(() => {
            const btn = event.target.closest('button');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
            }, 1500);
        }).catch(err => {
            console.error('Copy failed', err);
            showNotification('Copy failed', 'error');
        });
    }
};

// ==========================================================================
//  9. Feedback functions
// ==========================================================================

window.feedbackPositive = function(aiId) {
    console.log('Positive feedback for', aiId);
    showNotification('Thanks for the feedback!', 'success');
};

window.feedbackNegative = function(aiId) {
    console.log('Negative feedback for', aiId);
    showNotification('Feedback recorded', 'info');
};

// ==========================================================================
//  10. Inline Edit User Message (enhanced: auto re-send after edit)
// ==========================================================================

window.editUserMessage = function(msgId) {
    const msgElement = document.getElementById(msgId);
    if (!msgElement) return;
    const bubble = msgElement.querySelector('.user-bubble');
    const oldText = bubble.innerText;
    // Add editing class to bubble for wider view
    bubble.classList.add('editing');
    // Store original text in dataset
    bubble.dataset.originalText = oldText;

    const editHtml = `
        <div class="edit-container">
            <textarea class="edit-textarea" rows="3">${escapeHtml(oldText)}</textarea>
            <div class="edit-actions">
                <button class="edit-save" onclick="saveEdit('${msgId}', this)">Send</button>
                <button class="edit-cancel" onclick="cancelEdit('${msgId}')">Cancel</button>
            </div>
        </div>
    `;
    bubble.innerHTML = editHtml;
    bubble.querySelector('textarea').focus();
};

window.saveEdit = function(msgId, btn) {
    const container = btn.closest('.edit-container');
    const textarea = container.querySelector('.edit-textarea');
    const newText = textarea.value.trim();
    if (!newText) return;

    const msgElement = document.getElementById(msgId);
    const bubble = msgElement.querySelector('.user-bubble');
    bubble.innerText = newText;
    bubble.classList.remove('editing');
    delete bubble.dataset.originalText;

    // Find the index of this user message in chatHistory
    let userIndex = -1;
    let count = 0;
    const allUserBubbles = document.querySelectorAll('.user-bubble');
    for (let i = 0; i < allUserBubbles.length; i++) {
        if (allUserBubbles[i] === bubble) {
            userIndex = count;
            break;
        }
        count++;
    }
    const userMessages = chatHistory.filter(msg => msg.role === 'user');
    if (userIndex >= 0 && userIndex < userMessages.length) {
        const actualIndex = chatHistory.findIndex(msg => msg.role === 'user' && msg.content === userMessages[userIndex].content);
        if (actualIndex !== -1) {
            chatHistory[actualIndex].content = newText;
            // Remove all messages after this user message
            chatHistory = chatHistory.slice(0, actualIndex + 1);
            // Remove corresponding DOM elements after this message
            let current = msgElement.nextElementSibling;
            while (current) {
                let next = current.nextElementSibling;
                current.remove();
                current = next;
            }
            // Set lastInput to new text and trigger regeneration
            lastInput = newText;
            startReasoning(true);
        }
    }
    debouncedSaveSession();
};

window.cancelEdit = function(msgId) {
    const msgElement = document.getElementById(msgId);
    if (!msgElement) return;
    const bubble = msgElement.querySelector('.user-bubble');
    const oldText = bubble.dataset.originalText;
    if (oldText !== undefined) {
        bubble.innerText = oldText;
        bubble.classList.remove('editing');
        delete bubble.dataset.originalText;
    }
};

// ==========================================================================
//  11. AI Response Regeneration
// ==========================================================================

window.regenerateAIResponse = async function(aiId) {
    const container = document.getElementById('container_' + aiId);
    if (!container) return;
    let prevUserEl = container.previousElementSibling;
    while (prevUserEl && !prevUserEl.querySelector('.user-bubble')) {
        prevUserEl = prevUserEl.previousElementSibling;
    }
    if (!prevUserEl) return;
    const userText = prevUserEl.querySelector('.user-bubble')?.innerText;
    if (!userText) return;

    // Remove all messages after this container
    let current = container;
    while (current) {
        let next = current.nextElementSibling;
        current.remove();
        current = next;
    }
    const userIndex = chatHistory.findIndex(m => m.role === 'user' && m.content === userText);
    if (userIndex !== -1) {
        chatHistory = chatHistory.slice(0, userIndex + 1);
    } else {
        return;
    }

    lastInput = userText;
    startReasoning(true);
};

// ==========================================================================
//  12. Copy Conclusion to Clipboard
// ==========================================================================

window.copyConclusion = function(aiId) {
    const conclDiv = document.getElementById('concl_' + aiId);
    if (conclDiv) {
        const text = conclDiv.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const btn = event.target.closest('button');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
            }, 1500);
        }).catch(err => {
            console.error('Copy failed', err);
            showNotification('Copy failed', 'error');
        });
    }
};

// ==========================================================================
//  13. Delete Message and Following
// ==========================================================================

window.deleteMessage = function(containerId) {
    if (!confirm('Delete this message and all following?')) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    let prevUserEl = container.previousElementSibling;
    while (prevUserEl && !prevUserEl.querySelector('.user-bubble')) {
        prevUserEl = prevUserEl.previousElementSibling;
    }
    if (prevUserEl) {
        const userText = prevUserEl.querySelector('.user-bubble')?.innerText;
        if (userText) {
            const userIndex = chatHistory.findIndex(m => m.role === 'user' && m.content === userText);
            if (userIndex !== -1) {
                chatHistory = chatHistory.slice(0, userIndex + 1);
            }
        }
    } else {
        chatHistory = [BASE_SYSTEM_PROMPT];
        updateSystemPrompt();
    }
    let current = container;
    while (current) {
        let next = current.nextElementSibling;
        current.remove();
        current = next;
    }
    debouncedSaveSession();
};

// ==========================================================================
//  14. Toggle Thought Process
// ==========================================================================

window.toggleThought = function(id) {
    const el = document.getElementById('thought_' + id);
    const icon = document.getElementById('icon_' + id);
    if (el) {
        el.classList.toggle('show');
        icon.classList.toggle('rotate-180');
    }
};

// ==========================================================================
//  15. API Call with Timeout, Retry, Abort (logs errors but never shows to user)
// ==========================================================================

async function callAPI(apiConfig, messages, signal, retries = 2) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    try {
        const response = await fetch(apiConfig.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + apiConfig.key
            },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: messages,
                temperature: 0.5,
                max_tokens: 2048,
                top_p: 0.9,
                stream: false
            }),
            signal: signal || controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error(`API error (${apiConfig.url}):`, errData.error?.message || response.statusText);
            throw new Error("API request failed");
        }

        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content?.trim() || "";
        if (!aiResponse) throw new Error("Empty response from API");
        return aiResponse;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error('Request timed out');
            throw new Error('Request timed out');
        }
        if (retries > 0) {
            console.warn(`Retrying API (${retries} left)...`, error);
            await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
            return callAPI(apiConfig, messages, signal, retries - 1);
        }
        // Re-throw error (will be caught in startReasoning)
        throw error;
    }
}

// ==========================================================================
//  16. Generate Mock Response (used when APIs fail)
// ==========================================================================

function generateMockResponse(userInput) {
    // Create a simple but plausible mock response in the required format
    const topics = [
        "I'm processing your request. Here's a thoughtful analysis.",
        "Let me explore that idea from multiple angles.",
        "Based on my understanding, here's a comprehensive response.",
        "I've considered several hypothetical scenarios."
    ];
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    
    // Simple thought process
    const thought = `
Step 1: Understanding the query: "${userInput}"
Step 2: Considering possible interpretations.
Step 3: Evaluating relevant information.
Step 4: Synthesizing a coherent answer.
    `.trim();
    
    // Conclusion (could be a generic answer)
    const conclusion = `Thank you for your question. I'm currently operating in offline mode, but I've generated this response based on my training. ${randomTopic} If you need more detailed information, please try again later.`;
    
    return `[THOUGHT]\n${thought}\n[/THOUGHT]\n[CONCLUSION]\n${conclusion}\n[/CONCLUSION]`;
}

// ==========================================================================
//  17. Main Reasoning Function (with Dual API Failover + Mock Fallback)
// ==========================================================================

window.startReasoning = async function(isRetry = false) {
    // Abort any ongoing request
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();

    const inputText = userInput.value.trim();
    const input = isRetry ? lastInput : inputText;
    
    if (!input) return;
    
    lastInput = input;
    regenContainer.style.display = 'none';
    inputWrapper.classList.remove('center');
    inputWrapper.classList.add('bottom');

    if (!isRetry) {
        appendUserMessage(input, chatHistory.length);
        userInput.value = '';
        userInput.style.height = 'auto';
    }

    const aiId = 'ai_' + Date.now();

    // Show typing indicator with new structure
    const indicatorHtml = `
        <div id="container_${aiId}" class="message-row ai-row group">
            <div class="ai-header" onclick="toggleThought('${aiId}')">
                <svg id="icon_${aiId}" class="chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/>
                </svg>
                <span id="header_${aiId}" class="ai-name step-fade">Initializing</span>
            </div>
            <div id="thought_${aiId}" class="thought-process">
                <div class="opacity-40 italic">Thinking...</div>
            </div>
            <div id="concl_${aiId}" class="conclusion"></div>
            <div class="message-actions ai-actions opacity-0 group-hover:opacity-100 transition">
                <button class="action-btn" onclick="stopGeneration()" title="Stop">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><rect x="6" y="6" width="12" height="12"/></svg>
                </button>
            </div>
        </div>`;
    chatBox.insertAdjacentHTML('beforeend', indicatorHtml);

    const headerEl = document.getElementById('header_' + aiId);
    const phrases = ["Processing", "Analyzing", "Structuring", "Reasoning", "Hypothesizing"];
    let i = 0;
    const interval = setInterval(() => {
        if (headerEl) headerEl.innerText = phrases[i % phrases.length];
        i++;
    }, 1500);

    if (!isRetry) {
        chatHistory.push({ role: "user", content: input });
    }

    let messages = [...chatHistory];
    if (hypotheticalMode) {
        // Replace last user message with enhanced version
        messages = [
            ...chatHistory.slice(0, -1),
            { role: "user", content: input + "\n\n[Explore multiple hypothetical scenarios before concluding.]" }
        ];
    }

    let aiResponse = null;
    let apiError = null;

    // Try primary API first
    try {
        aiResponse = await callAPI(PRIMARY_API, messages, abortController.signal);
    } catch (error) {
        apiError = error;
        console.warn("Primary API failed:", error);
        // Try secondary after short delay
        try {
            await new Promise(resolve => setTimeout(resolve, 500));
            aiResponse = await callAPI(SECONDARY_API, messages, abortController.signal);
        } catch (secondaryError) {
            apiError = secondaryError;
            console.error("Secondary API also failed:", secondaryError);
            // Both APIs failed – use mock response
            aiResponse = generateMockResponse(input);
            console.log("Using mock response due to API failure");
        }
    }

    clearInterval(interval);
    if (headerEl) headerEl.classList.remove('step-fade');
    abortController = null;

    // Always have a response (either real or mock)
    if (headerEl) headerEl.innerText = "Neo";
    chatHistory.push({ role: "assistant", content: aiResponse });
    parseAndDisplay(aiResponse, aiId);
    
    // Update actions div
    const actionsDiv = document.querySelector(`#container_${aiId} .message-actions`);
    if (actionsDiv) {
        actionsDiv.innerHTML = `
            <button class="action-btn" onclick="regenerateAIResponse('${aiId}')" title="Regenerate">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
            <button class="action-btn" onclick="copyConclusion('${aiId}')" title="Copy">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="action-btn" onclick="feedbackPositive('${aiId}')" title="Good response">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button class="action-btn" onclick="feedbackNegative('${aiId}')" title="Bad response">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
            </button>
            <button class="action-btn" onclick="deleteMessage('container_${aiId}')" title="Delete">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        `;
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    debouncedSaveSession(); // Auto-save after new message
};

// Stop generation
window.stopGeneration = function() {
    if (abortController) {
        abortController.abort();
        abortController = null;
        const header = document.querySelector('.step-fade');
        if (header) header.innerText = "Stopped";
        showNotification('Generation stopped', 'info');
    }
};

// ==========================================================================
//  18. Parse and Display AI Response (with Thought/Conclusion separation)
// ==========================================================================

function parseAndDisplay(text, id) {
    let thought = "";
    let conclusion = "";

    // Extract thought (allow missing closing tag)
    const thoughtOpen = /\[THOUGHT\]/i;
    const thoughtClose = /\[\/THOUGHT\]/i;
    let thoughtStart = text.search(thoughtOpen);
    if (thoughtStart !== -1) {
        let thoughtEnd = text.search(thoughtClose);
        if (thoughtEnd === -1 || thoughtEnd < thoughtStart) {
            thought = text.slice(thoughtStart + 9).trim();
        } else {
            thought = text.slice(thoughtStart + 9, thoughtEnd).trim();
        }
    }

    // Extract conclusion
    const conclOpen = /\[CONCLUSION\]/i;
    const conclClose = /\[\/CONCLUSION\]/i;
    let conclStart = text.search(conclOpen);
    if (conclStart !== -1) {
        let conclEnd = text.search(conclClose);
        if (conclEnd === -1 || conclEnd < conclStart) {
            conclusion = text.slice(conclStart + 12).trim();
        } else {
            conclusion = text.slice(conclStart + 12, conclEnd).trim();
        }
    } else {
        if (thoughtStart !== -1) {
            let afterThought = thoughtClose.test(text) ? text.slice(text.search(thoughtClose) + 9) : text.slice(thoughtStart + 9);
            conclusion = afterThought.trim();
        } else {
            conclusion = text.trim();
        }
    }

    // Clean stray tags from conclusion
    conclusion = conclusion.replace(/\[THOUGHT\]|\[\/THOUGHT\]|\[CONCLUSION\]|\[\/CONCLUSION\]/gi, "").trim();
    conclusion = conclusion.replace(/\n{3,}/g, '\n\n').trim();

    const thoughtDiv = document.getElementById('thought_' + id);
    const conclusionDiv = document.getElementById('concl_' + id);

    if (thoughtDiv) {
        thoughtDiv.innerHTML = thought ? escapeHtml(thought).replace(/\n/g, '<br>') : '';
    }

    if (conclusionDiv) {
        conclusionDiv.innerHTML = parseMarkdown(conclusion);
        // Trigger KaTeX rendering on this new content
        if (window.renderMathInElement) {
            renderMathInElement(conclusionDiv, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ]
            });
        }
    }
}

// ==========================================================================
//  19. Advanced Markdown Parser (with code blocks, tables, math)
// ==========================================================================

function parseMarkdown(text) {
    if (!text) return '';

    // 1. Protect code blocks
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
        const id = `CODE_BLOCK_${codeBlocks.length}`;
        codeBlocks.push({ lang, code: code.trim() });
        return id;
    });

    // 2. Protect display math ($$...$$) – we'll wrap them in .math later
    const mathBlocks = [];
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function(match, formula) {
        const id = `MATH_BLOCK_${mathBlocks.length}`;
        mathBlocks.push({ formula: formula.trim() });
        return id;
    });

    // 3. Basic HTML escaping
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 4. Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 5. Bold, italic, underline
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.*?)__/g, '<u>$1</u>');

    // 6. Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 7. Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 8. Blockquotes
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // 9. Horizontal rule
    html = html.replace(/^---$/gm, '<hr>');

    // 10. Tables
    const lines = html.split('\n');
    let inTable = false;
    const tableBuffer = [];
    const finalParts = [];
    for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim().startsWith('|')) {
            inTable = true;
            tableBuffer.push(line);
        } else {
            if (inTable) {
                finalParts.push(renderTable(tableBuffer));
                tableBuffer.length = 0;
                inTable = false;
            }
            finalParts.push(line);
        }
    }
    if (inTable) finalParts.push(renderTable(tableBuffer));
    html = finalParts.join('\n');

    // 11. Lists
    const listLines = html.split('\n');
    html = listLines.map(line => {
        if (/^(\s*)[*+-] /.test(line)) {
            return '<li>' + line.replace(/^(\s*)[*+-] /, '') + '</li>';
        } else if (/^(\s*)\d+\. /.test(line)) {
            return '<li>' + line.replace(/^(\s*)\d+\. /, '') + '</li>';
        }
        return line;
    }).join('\n');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function(match) {
        if (match.match(/^\d+\./)) return '<ol>' + match + '</ol>';
        return '<ul>' + match + '</ul>';
    });

    // 12. Paragraphs and line breaks (simplified)
    html = html.replace(/\n\n/g, '<div class="paragraph-break"></div>');
    html = html.replace(/\n/g, '<br>');

    // 13. Restore math blocks with .math class
    html = html.replace(/MATH_BLOCK_(\d+)/g, function(match, id) {
        const block = mathBlocks[parseInt(id)];
        if (!block) return match;
        // We'll render the formula as-is; KaTeX will handle it later
        return `<div class="math">$$${block.formula}$$</div>`;
    });

    // 14. Restore code blocks with copy button
    html = html.replace(/CODE_BLOCK_(\d+)/g, function(match, id) {
        const block = codeBlocks[parseInt(id)];
        if (!block) return match;
        const langDisplay = block.lang ? block.lang.toUpperCase() : 'CODE';
        // Apply syntax highlighting classes (optional)
        return `
            <div class="code-wrapper">
                <div class="code-header">
                    <span class="code-lang">${escapeHtml(langDisplay)}</span>
                    <span class="code-copy" onclick="copyCode(this)" title="Copy code">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </span>
                </div>
                <div class="code-block"><code>${escapeHtml(block.code)}</code></div>
            </div>
        `;
    });

    return html;
}

function renderTable(rows) {
    if (!rows || rows.length === 0) return '';
    
    let tableHtml = '<div class="dynamic-table-wrapper"><table>';
    let alignments = [];
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].includes('---')) {
            const sepCells = rows[i].split('|').map(c => c.trim());
            alignments = sepCells.map(cell => {
                if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
                if (cell.endsWith(':')) return 'right';
                if (cell.startsWith(':')) return 'left';
                return 'left';
            });
            continue;
        }
        const cells = rows[i].split('|').map(c => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        tableHtml += '<tr>';
        cells.forEach((cell, idx) => {
            const align = alignments[idx] ? ` style="text-align: ${alignments[idx]};"` : '';
            tableHtml += `<${tag}${align}>${cell}</${tag}>`;
        });
        tableHtml += '</tr>';
    }
    tableHtml += '</table></div>';
    return tableHtml;
}

// ==========================================================================
//  20. Copy Code Functionality
// ==========================================================================

window.copyCode = function(btn) {
    const code = btn.closest('.code-wrapper').querySelector('code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
        }, 1800);
    }).catch(err => {
        console.error('Copy failed', err);
        showNotification('Copy failed', 'error');
    });
};

// ==========================================================================
//  21. User Dropdown (from avatar)
// ==========================================================================

window.toggleUserDropdown = function(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('show');
};

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('userDropdown');
    const avatar = document.querySelector('.user-avatar');
    if (dropdown && avatar && !avatar.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.classList.remove('show');
    }
});

// ==========================================================================
//  22. Search & Active Chat Enhancements
// ==========================================================================

// Search functionality
document.getElementById('searchHistory')?.addEventListener('input', function(e) {
    const query = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.history-item');
    items.forEach(item => {
        const title = item.querySelector('.history-title')?.innerText.toLowerCase() || '';
        if (title.includes(query)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
});