/* ============================================================
   markdown-renderer.js
   独立的 Markdown 渲染引擎，支持扩展语法、LaTeX、Mermaid 等
   依赖（需在页面中预先加载）：
   - KaTeX (CSS + JS)  https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/
   - markdown-it       https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/
   - markdown-it-task-lists, markdown-it-emoji, markdown-it-footnote,
     markdown-it-deflist, markdown-it-abbr (均为 CDN 插件)
   - DOMPurify         https://cdn.jsdelivr.net/npm/dompurify@3.0.6/
   - Mermaid           https://cdn.jsdelivr.net/npm/mermaid@10/dist/
   若未加载，本库将抛出错误提示。
   ============================================================ */

(function (global) {
    'use strict';

    // ---------- 依赖检查 ----------
    function checkDeps() {
        const deps = [
            { name: 'KaTeX', obj: global.katex },
            { name: 'markdown-it', obj: global.markdownit },
            { name: 'DOMPurify', obj: global.DOMPurify },
            { name: 'Mermaid', obj: global.mermaid },
            { name: 'markdown-it-task-lists', obj: global.markdownitTaskLists },
            { name: 'markdown-it-emoji', obj: global.markdownitEmoji },
            { name: 'markdown-it-footnote', obj: global.markdownitFootnote },
            { name: 'markdown-it-deflist', obj: global.markdownitDeflist },
            { name: 'markdown-it-abbr', obj: global.markdownitAbbr }
        ];
        const missing = deps.filter(d => !d.obj);
        if (missing.length) {
            throw new Error(
                'MarkdownRenderer: 缺少依赖库: ' + missing.map(d => d.name).join(', ') +
                '\n请确保已通过 CDN 加载所有依赖。'
            );
        }
    }
    checkDeps();

    // ---------- markdown-it 实例 ----------
    const md = global.markdownit({ html: false, linkify: true, typographer: true });
    md.use(global.markdownitTaskLists);
    md.use(global.markdownitEmoji);
    md.use(global.markdownitFootnote);
    md.use(global.markdownitDeflist);
    md.use(global.markdownitAbbr);

    // ---------- 辅助函数 ----------
    function escapeHtmlAttr(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // ---------- 洛谷扩展预处理 ----------
    function preprocessLuoguSyntax(text) {
        // Bilibili 简写
        text = text.replace(/!\[\]\(bilibili:([^)]+)\)/g, (match, param) => {
            let bvid = '', aid = '', extraParams = '';
            const queryIndex = param.indexOf('?');
            let base = param;
            if (queryIndex !== -1) {
                base = param.substring(0, queryIndex);
                extraParams = param.substring(queryIndex);
                extraParams = extraParams.replace(/^\?/, '&');
            }
            const lowerBase = base.toLowerCase();
            if (lowerBase.startsWith('bv')) {
                bvid = base;
            } else if (lowerBase.startsWith('av')) {
                aid = base.substring(2);
            } else if (/^\d+$/.test(base)) {
                aid = base;
            } else {
                return match;
            }
            let embedUrl = 'https://player.bilibili.com/player.html?';
            if (bvid) embedUrl += `bvid=${bvid}`;
            else if (aid) embedUrl += `aid=${aid}`;
            if (extraParams) embedUrl += extraParams;
            if (!extraParams.includes('page=')) embedUrl += '&page=1';
            return `<iframe src="${embedUrl}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>`;
        });

        // 通用嵌入
        text = text.replace(/!\[\]\(embed:([^)]+)\)/g, (match, url) => {
            return `<iframe src="${url}" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>`;
        });

        // 旧版 [bilibili] 标签
        text = text.replace(/\[bilibili\](BV[a-zA-Z0-9]+)\[\/bilibili\]/g, (m, bvid) =>
            `<iframe src="https://player.bilibili.com/player.html?bvid=${bvid}&page=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>`
        );

        // align 语法
        text = text.replace(/:::align\{center\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_CENTER%%$1%%ALIGN_END%%');
        text = text.replace(/:::align\{right\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_RIGHT%%$1%%ALIGN_END%%');

        return text;
    }

    // ---------- 解析嵌套折叠框 ----------
    function parseNestedDetails(text) {
        const lines = text.split('\n');
        const output = [];
        const stack = [];
        const roots = [];
        let i = 0;

        while (i < lines.length) {
            const rawLine = lines[i];
            const trimmed = rawLine.trim();
            let startMatch = null;
            if (trimmed.startsWith(':::')) {
                let colonsCount = 0;
                while (colonsCount < trimmed.length && trimmed[colonsCount] === ':') colonsCount++;
                if (colonsCount >= 3) {
                    const rest = trimmed.slice(colonsCount).trim();
                    const typeMatch = rest.match(/^([a-zA-Z0-9]+)/);
                    if (typeMatch) {
                        const type = typeMatch[1];
                        let title = '', openAttr = '';
                        let remaining = rest.slice(type.length).trim();
                        const titleMatch = remaining.match(/^\[([^\]]*)\]/);
                        if (titleMatch) {
                            title = titleMatch[1];
                            remaining = remaining.slice(titleMatch[0].length).trim();
                        }
                        remaining = remaining.trim();
                        if (remaining.startsWith('{open}')) {
                            openAttr = ' open';
                            remaining = remaining.slice(6).trim();
                        }
                        if (!remaining) {
                            startMatch = { colonsCount, type, title, openAttr };
                        }
                    }
                }
            }

            if (startMatch && ['info', 'success', 'warning', 'error'].includes(startMatch.type)) {
                const node = {
                    type: startMatch.type,
                    title: startMatch.title,
                    openAttr: startMatch.openAttr,
                    colonsCount: startMatch.colonsCount,
                    contentLines: [],
                    children: []
                };
                stack.push(node);
                i++;
                continue;
            }

            let endMatch = null;
            if (trimmed.startsWith(':::')) {
                let colonsCount = 0;
                while (colonsCount < trimmed.length && trimmed[colonsCount] === ':') colonsCount++;
                if (colonsCount >= 3 && trimmed.slice(colonsCount).trim() === '') {
                    endMatch = { colonsCount };
                }
            }

            if (endMatch && stack.length > 0) {
                const top = stack[stack.length - 1];
                if (endMatch.colonsCount === top.colonsCount) {
                    const node = stack.pop();
                    if (stack.length === 0) {
                        const idx = roots.length;
                        roots.push(node);
                        output.push(`%%DETAILS_ROOT_${idx}%%`);
                    } else {
                        stack[stack.length - 1].children.push(node);
                    }
                    i++;
                    continue;
                }
            }

            if (stack.length > 0) {
                stack[stack.length - 1].contentLines.push(rawLine);
            } else {
                output.push(rawLine);
            }
            i++;
        }

        while (stack.length > 0) {
            const node = stack.pop();
            const idx = roots.length;
            roots.push(node);
            output.push(`%%DETAILS_ROOT_${idx}%%`);
        }

        return { roots, output: output.join('\n') };
    }

    // ---------- LaTeX 渲染 ----------
    function renderLatex(text) {
        if (!text) return '';
        text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
            let realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            try {
                return `<div style="text-align:center;margin:8px 0;">${global.katex.renderToString(realMath, { displayMode: true, throwOnError: false })}</div>`;
            } catch (e) { return match; }
        });
        text = text.replace(/\$([^$]+?)\$/g, (match, math) => {
            let realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            try {
                return global.katex.renderToString(realMath, { throwOnError: false });
            } catch (e) { return match; }
        });
        return text;
    }

    // ---------- 递归渲染折叠框节点 ----------
    function renderDetailsNode(node) {
        let content = node.contentLines.join('\n');
        content = renderLatex(content);
        const renderedContent = md.render(content);
        let title = renderLatex(node.title);
        const renderedTitle = md.renderInline(title);
        const childrenHtml = node.children.map(child => renderDetailsNode(child)).join('');
        const openAttr = node.openAttr && node.openAttr.trim() === 'open' ? ' open' : '';
        return `<details class="${escapeHtmlAttr(node.type)}"${openAttr}><summary>${renderedTitle}</summary>${renderedContent}${childrenHtml}</details>`;
    }

    // ---------- 生成目录 ----------
    function generateTOC(htmlText, uniqueId) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const body = doc.body;
        const headers = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headers.length === 0) return htmlText;

        let idCounter = 0;
        const tocItems = [];
        headers.forEach(el => {
            let id = el.getAttribute('id');
            if (!id) {
                id = uniqueId ? `${uniqueId}-toc-${idCounter++}` : `toc-${idCounter++}`;
                el.setAttribute('id', id);
            }
            const text = el.textContent.trim();
            tocItems.push({ level: parseInt(el.tagName[1]), id, text });
        });

        if (tocItems.length === 0) return htmlText;

        let tocHtml = '<div class="toc"><ul>';
        let currentLevel = 0;
        for (const item of tocItems) {
            const level = item.level;
            if (level > currentLevel) {
                for (let j = 0; j < level - currentLevel; j++) tocHtml += '<ul>';
            } else if (level < currentLevel) {
                for (let j = 0; j < currentLevel - level; j++) tocHtml += '</ul>';
            }
            tocHtml += `<li><a href="#${item.id}">${item.text}</a></li>`;
            currentLevel = level;
        }
        while (currentLevel > 1) {
            tocHtml += '</ul>';
            currentLevel--;
        }
        tocHtml += '</ul></div>';

        let newHtml = body.innerHTML;
        newHtml = newHtml.replace(/\[\[TOC\]\]/g, tocHtml);
        return newHtml;
    }

    // ---------- 核心渲染函数 ----------
    function renderContent(rawText, mentionMap, isAdmin, username, uniqueId) {
        if (!rawText) return '';

        // 解码 HTML 实体
        rawText = rawText
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');

        // 解析折叠框
        const { roots, output } = parseNestedDetails(rawText);
        rawText = output;
        const detailRoots = roots;

        // 提取 Mermaid
        const mermaidBlocks = [];
        rawText = rawText.replace(/```mermaid\s*([\s\S]*?)```/g, (match, code) => {
            const idx = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
            return `%%MERMAID_${idx}%%`;
        });

        // 提取围栏代码块
        const lines = rawText.split('\n');
        const blocks = [];
        let processedLines = [];
        let inFence = false;
        let fenceContent = [];
        let blockIdx = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const prefixMatch = line.match(/^(>\s*)+/);
            const prefix = prefixMatch ? prefixMatch[0] : '';
            const cleanLine = line.replace(/^(>\s?)+/, '');

            if (!inFence && cleanLine.startsWith('```')) {
                inFence = true;
                fenceContent = [cleanLine];
                processedLines.push(prefix + `%%BLOCK${blockIdx}%%`);
            } else if (inFence) {
                fenceContent.push(cleanLine);
                if (cleanLine.trim() === '```') {
                    inFence = false;
                    const content = fenceContent.join('\n');
                    const firstLine = fenceContent[0] || '';
                    let lang = '', filename = '';
                    if (firstLine.startsWith('```')) {
                        const params = firstLine.slice(3).trim();
                        const parts = params.split(/\s+/);
                        const firstPart = parts[0] || '';
                        if (firstPart.includes(':')) {
                            const [langPart, ...fileParts] = firstPart.split(':');
                            lang = langPart;
                            filename = fileParts.join(':');
                        } else {
                            lang = firstPart;
                        }
                    }
                    blocks.push({ type: 'fence', content, filename, lang });
                    blockIdx++;
                }
            } else {
                processedLines.push(line);
            }
        }
        if (inFence && fenceContent.length > 0) {
            const content = fenceContent.join('\n');
            const firstLine = fenceContent[0] || '';
            let lang = '', filename = '';
            if (firstLine.startsWith('```')) {
                const params = firstLine.slice(3).trim();
                const parts = params.split(/\s+/);
                const firstPart = parts[0] || '';
                if (firstPart.includes(':')) {
                    const [langPart, ...fileParts] = firstPart.split(':');
                    lang = langPart;
                    filename = fileParts.join(':');
                } else {
                    lang = firstPart;
                }
            }
            blocks.push({ type: 'fence', content, filename, lang });
            blockIdx++;
        }
        let processed = processedLines.join('\n');

        // 内联代码
        processed = processed.replace(/`([^`]+)`/g, (match, code) => {
            if (/^%%BLOCK\d+%%$/.test(match)) return match;
            const idx = blocks.length;
            const safeCode = code.replace(/\n/g, '&#10;');
            blocks.push({ type: 'inline', content: safeCode });
            return `%%BLOCK${idx}%%`;
        });

        // 洛谷扩展
        processed = preprocessLuoguSyntax(processed);

        // LaTeX（先执行一次）
        processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
            let realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            try {
                return `<div style="text-align:center;margin:8px 0;">${global.katex.renderToString(realMath, { displayMode: true, throwOnError: false })}</div>`;
            } catch (e) { return match; }
        });
        processed = processed.replace(/\$([^$]+?)\$/g, (match, math) => {
            let realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            try {
                return global.katex.renderToString(realMath, { throwOnError: false });
            } catch (e) { return match; }
        });

        // 图片尺寸
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x(\d*)\)/g, (match, alt, url, width, height) => {
            const style = `width:${width}px;${height ? ` height:${height}px;` : ''}`;
            return `<img alt="${escapeHtmlAttr(alt)}" src="${escapeHtmlAttr(url)}" style="${style}">`;
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x\)/g, (match, alt, url, width) => {
            return `<img alt="${escapeHtmlAttr(alt)}" src="${escapeHtmlAttr(url)}" style="width:${width}px; height:auto;">`;
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*x(\d+)\)/g, (match, alt, url, height) => {
            return `<img alt="${escapeHtmlAttr(alt)}" src="${escapeHtmlAttr(url)}" style="height:${height}px; width:auto;">`;
        });

        // 删除线、高亮、插入、小号、上标、下标
        processed = processed.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        processed = processed.replace(/==([^=]+)==/g, '<mark>$1</mark>');
        processed = processed.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
        processed = processed.replace(/(?<![:\-])--([^-]+)--(?![:\-])/g, '<small>$1</small>');
        processed = processed.replace(/(?<![\[\^])\^([^^]+)\^(?![\]])/g, '<sup>$1</sup>');
        processed = processed.replace(/~([^~]+)~/g, '<sub>$1</sub>');

        // 键盘按键 & TOC 占位
        processed = processed.replace(/\[\[TOC\]\]/g, '%%TOC_PLACEHOLDER%%');
        processed = processed.replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>');
        processed = processed.replace(/%%TOC_PLACEHOLDER%%/g, '[[TOC]]');

        // 管理员专属语法
        if (isAdmin) {
            processed = processed.replace(/\[admin\]([\s\S]*?)\[\/admin\]/g, (match, content) => {
                return `<blockquote class="admin-public-comment"><p>管理组提示：</p><div class="lfe-marked-wrap"><div class="lfe-marked">${content}</div></div></blockquote>`;
            });
            processed = processed.replace(/\{rainbow\}([\s\S]*?)\{rainbow\}/g, (match, content) => {
                const chars = content.split('');
                const len = chars.length;
                if (len === 0) return '';
                const startHue = 0, endHue = 300;
                let result = '';
                for (let i = 0; i < len; i++) {
                    const hue = startHue + (endHue - startHue) * (i / (len - 1));
                    result += `<span style="color:hsl(${hue}, 100%, 50%);">${chars[i]}</span>`;
                }
                return `<span style="font-weight:bold;">${result}</span>`;
            });
            processed = processed.replace(/\[sign\]([\s\S]*?)\[\/sign\]/g, (match, content) => {
                return `<div class="signature-block">${content}<div class="signature-name">—— ✨ Jason227 高贵的用户：${escapeHtmlAttr(username)}</div></div>`;
            });
        }

        let html = md.render(processed);

        // 脚注 ID 前缀
        if (uniqueId) {
            html = html.replace(/\bid="(fn|fnref)(\d+)"/g, `id="${uniqueId}-$1$2"`);
            html = html.replace(/href="#(fn|fnref)(\d+)"/g, `href="#${uniqueId}-$1$2"`);
        }

        // 生成目录
        html = generateTOC(html, uniqueId);

        // 恢复 Mermaid
        html = html.replace(/%%MERMAID_(\d+)%%/g, (match, idx) => {
            const code = mermaidBlocks[parseInt(idx)];
            if (!code) return match;
            return `<div class="mermaid">${code}</div>`;
        });

        // 恢复折叠框
        html = html.replace(/%%DETAILS_ROOT_(\d+)%%/g, (match, idx) => {
            const node = detailRoots[parseInt(idx)];
            if (!node) return match;
            return renderDetailsNode(node);
        });

        // 对齐
        html = html.replace(/%%ALIGN_CENTER%%([\s\S]*?)%%ALIGN_END%%/g, (match, content) => {
            const rendered = md.render(content);
            return `<div class="align-center">${rendered}</div>`;
        });
        html = html.replace(/%%ALIGN_RIGHT%%([\s\S]*?)%%ALIGN_END%%/g, (match, content) => {
            const rendered = md.render(content);
            return `<div class="align-right">${rendered}</div>`;
        });

        // 中文引号修复
        html = html.replace(/“/g, '"').replace(/”/g, '"');

        // 恢复代码块
        html = html.replace(/%%BLOCK(\d+)%%/g, (match, idx) => {
            let block = blocks[parseInt(idx)];
            if (!block) return '';

            if (block.type === 'inline') {
                return `<code>${escapeHtml(block.content)}</code>`;
            }

            const lines = block.content.split('\n');
            const firstLine = lines[0];
            let lang = '', showLineNumbers = false, showHighlight = false, highlightLines = null;
            if (firstLine.startsWith('```')) {
                const params = firstLine.slice(3).trim();
                const parts = params.split(/\s+/);
                lang = parts[0] || '';
                if (params.includes('line-numbers')) showLineNumbers = true;
                const linesMatch = params.match(/lines=(\d+)-(\d+)/);
                if (linesMatch) {
                    showHighlight = true;
                    highlightLines = { start: parseInt(linesMatch[1]), end: parseInt(linesMatch[2]) };
                }
            }
            let codeContent = lines.slice(1, -1).join('\n');
            const codeLines = codeContent.split('\n');
            if (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
            const totalLines = codeLines.length;
            const maxDigits = String(totalLines).length;

            let titleHtml = '';
            if (block.filename) {
                titleHtml = `<div class="code-filename">${escapeHtml(block.filename)}</div>`;
            }

            let codeHtml = `<pre><code>`;
            for (let i = 0; i < totalLines; i++) {
                const lineNum = i + 1;
                const lineContent = codeLines[i] || ' ';
                let lineClass = '';
                if (showHighlight && highlightLines && lineNum >= highlightLines.start && lineNum <= highlightLines.end) {
                    lineClass = ' code-highlight-line';
                }
                codeHtml += `<div class="code-line${lineClass}">`;
                if (showLineNumbers) {
                    codeHtml += `<span class="line-number" style="min-width:${maxDigits + 1}ch;">${lineNum}</span>`;
                }
                codeHtml += `<span class="code-text">${escapeHtml(lineContent)}</span>`;
                codeHtml += `</div>`;
            }
            codeHtml += `</code></pre>`;

            return `
                ${titleHtml}
                <div class="code-block-wrapper">
                    <button class="copy-code-btn">
                        <svg class="svg-icon" viewBox="0 0 448 512" aria-hidden="true">
                            <path d="M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z"/>
                        </svg>
                    </button>
                    ${codeHtml}
                </div>
            `;
        });

        // @提及
        html = html.replace(/@([\u4e00-\u9fa5a-zA-Z0-9_.-]+)/g, (match, username) => {
            const uid = mentionMap && mentionMap[username];
            if (uid)
                return `@<a href="/user/${uid}" class="mention-link" style="color:#e74c3c; text-decoration:none;">${escapeHtmlAttr(username)}</a>`;
            return match;
        });

        // 清理空段落
        html = html.replace(/<p><\/p>\s*$/, '').replace(/<br\s*\/?>\s*$/, '').trim();
        html = html.replace(/<p>\s*<\/p>/g, '').replace(/:\s*$/gm, '');

        // 净化
        return global.DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe', 'section', 'ol', 'li', 'sup', 'sub', 'mark', 'ins', 'small', 'kbd', 'del', 'div'],
            ADD_ATTR: ['src', 'width', 'height', 'scrolling', 'border', 'frameborder', 'framespacing',
                'allowfullscreen', 'style', 'id', 'class', 'href', 'open'
            ]
        });
    }

    // ---------- 复制功能 ----------
    function showCopyToast() {
        let toast = document.querySelector('.swal2-toast-copy');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'swal2-toast-copy';
            toast.innerHTML = `
                <svg class="success-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#a5dc86" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
                <h2 class="swal2-title-copy">Contents copied!</h2>
            `;
            document.body.appendChild(toast);
        } else {
            toast.classList.remove('show');
            void toast.offsetWidth;
        }
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showCopyToast();
        } catch (e) {
            alert('复制失败，请手动复制');
        }
        document.body.removeChild(textarea);
    }

    function copyCode(btn) {
        const wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        const pre = wrapper.querySelector('pre');
        if (!pre) return;

        const codeTexts = pre.querySelectorAll('.code-text');
        let code = '';
        codeTexts.forEach(el => {
            code += el.textContent + '\n';
        });
        code = code.replace(/\n$/, '');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(showCopyToast).catch(() => fallbackCopy(code));
        } else {
            fallbackCopy(code);
        }
    }

    // ---------- 对外 API ----------
    function renderHTML(markdownText, options) {
        options = options || {};
        const isAdmin = options.isAdmin || false;
        const username = options.username || '用户';
        const mentionMap = options.mentionMap || {};
        const uniqueId = options.uniqueId || '';
        return renderContent(markdownText, mentionMap, isAdmin, username, uniqueId);
    }

    function renderToElement(element, markdownText, options) {
        if (!element) throw new Error('renderToElement: 目标元素不能为空');
        const html = renderHTML(markdownText, options);
        element.innerHTML = html;

        // 渲染 Mermaid
        if (global.mermaid) {
            try {
                global.mermaid.run({ nodes: element.querySelectorAll('.mermaid') });
            } catch (e) {
                console.warn('Mermaid 渲染失败:', e);
            }
        }
    }

    // 事件委托：复制按钮
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('.copy-code-btn');
        if (btn) {
            e.preventDefault();
            copyCode(btn);
        }
    });

    // 暴露全局 API
    global.MarkdownRenderer = {
        render: renderHTML,
        renderToElement: renderToElement,
        version: '1.0.0'
    };

})(window);