// ATUALIZAÇÃO: Suporte a tempo customizado de tela para o balão
export function showToastWarning(message, type = 'error', customDuration = null) {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;

    fb.classList.remove('hidden');
    fb.innerHTML = message;
    fb.style.display = 'block';
    fb.style.backgroundColor = type === 'success' ? '#27ae60' : (type === 'warning' ? '#f39c12' : '#e74c3c');
    fb.style.color = '#fff';
    fb.style.padding = '15px 20px';
    fb.style.borderRadius = '6px';
    fb.style.marginBottom = '15px';
    fb.style.fontWeight = 'bold';
    fb.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    fb.style.textAlign = 'center';
    fb.style.fontSize = '1.1em';
    fb.style.lineHeight = '1.4';

    const duration = customDuration || (type === 'success' ? 4500 : 7000);
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        fb.style.display = 'none';
        fb.classList.add('hidden');
    }, duration);
}

export function showPersistentStatusMessage(message, type = 'success') {
    const fb = document.getElementById('feedback-msg');
    if (!fb) return;

    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
        window.toastTimeout = null;
    }

    const backgroundColor = type === 'success'
        ? '#27ae60'
        : (type === 'warning' ? '#f39c12' : '#e74c3c');

    fb.classList.remove('hidden');
    fb.style.display = 'block';
    fb.style.backgroundColor = backgroundColor;
    fb.style.color = '#fff';
    fb.style.padding = '15px 20px';
    fb.style.borderRadius = '6px';
    fb.style.marginBottom = '15px';
    fb.style.fontWeight = 'bold';
    fb.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
    fb.style.textAlign = 'center';
    fb.style.fontSize = '1.05em';
    fb.style.lineHeight = '1.4';
    fb.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:12px; flex-wrap:wrap;">
            <span>${message}</span>
            <button id="btn-feedback-persistent-ok" type="button" style="background:#ffffff; color:${backgroundColor}; border:none; border-radius:999px; padding:8px 16px; font-weight:800; cursor:pointer;">OK</button>
        </div>
    `;

    const btnOk = document.getElementById('btn-feedback-persistent-ok');
    if (btnOk) {
        btnOk.onclick = () => {
            fb.style.display = 'none';
            fb.classList.add('hidden');
            fb.innerHTML = '';
        };
    }
}

export async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

export function flashButtonCopyState(btn, label = 'Copiado', duration = 2000) {
    if (!btn) return;

    const origHtml = btn.innerHTML;
    const origBg = btn.style.backgroundColor;
    const origColor = btn.style.color;
    const origBorder = btn.style.borderColor;

    btn.innerHTML = label;
    btn.style.backgroundColor = '#27ae60';
    btn.style.color = '#ffffff';
    btn.style.borderColor = '#27ae60';

    setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.backgroundColor = origBg;
        btn.style.color = origColor;
        btn.style.borderColor = origBorder;
    }, duration);
}

export function setupCopyActionButtons() {
    document.querySelectorAll('[data-copy-text]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;

        btn.dataset.bound = '1';
        btn.addEventListener('click', async () => {
            const text = btn.dataset.copyText || '';
            const successLabel = btn.dataset.copySuccessLabel || 'Copiado';
            const feedbackId = btn.dataset.copyFeedbackTarget || '';
            const feedback = feedbackId ? document.getElementById(feedbackId) : null;

            try {
                await copyTextToClipboard(text);
                flashButtonCopyState(btn, successLabel);
                if (feedback) {
                    feedback.textContent = `${successLabel}.`;
                    setTimeout(() => {
                        if (feedback.textContent === `${successLabel}.`) feedback.innerHTML = '&nbsp;';
                    }, 2200);
                }
            } catch (err) {
                console.error('Falha ao copiar texto', err);
                if (feedback) feedback.textContent = 'N\u00e3o foi poss\u00edvel copiar. Copie manualmente.';
                showToastWarning('N\u00e3o foi poss\u00edvel copiar o conte\u00fado. Copie manualmente.', 'warning', 2600);
            }
        });
    });
}
