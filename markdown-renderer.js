/**
 * markdown-renderer.js
 * 完整提取自 ✨ Jason227 主页的渲染引擎
 * 依赖（需外部加载）：markdown-it, katex, mermaid, DOMPurify
 * 导出：renderContent(rawText, mentionMap, isAdmin, username, uniqueId)
 *       及 copyCode(btn) 用于复制功能
 */
(function() {
    'use strict';

    // ---------- 辅助函数 ----------
    function escapeHtmlAttr(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // ---------- 初始化 markdown-it ----------
    var md = window.markdownit({ html: true, linkify: true, typographer: true });
    if (window.markdownitTaskLists) md.use(window.markdownitTaskLists);
    if (window.markdownitEmoji) md.use(window.markdownitEmoji);
    if (window.markdownitFootnote) md.use(window.markdownitFootnote);
    if (window.markdownitDeflist) md.use(window.markdownitDeflist);
    if (window.markdownitAbbr) md.use(window.markdownitAbbr);

    // ---------- 洛谷扩展预处理 ----------
    function preprocessLuoguSyntax(text) {
        // 1. Bilibili 简写：![](bilibili:xxx)
        text = text.replace(/!\[\]\(bilibili:([^)]+)\)/g, function(match, param) {
            var bvid = '', aid = '', extraParams = '';
            var queryIndex = param.indexOf('?');
            var base = param;
            if (queryIndex !== -1) {
                base = param.substring(0, queryIndex);
                extraParams = param.substring(queryIndex).replace(/^\?/, '&');
            }
            var lowerBase = base.toLowerCase();
            if (lowerBase.startsWith('bv')) bvid = base;
            else if (lowerBase.startsWith('av')) aid = base.substring(2);
            else if (/^\d+$/.test(base)) aid = base;
            else return match;
            var embedUrl = 'https://player.bilibili.com/player.html?';
            if (bvid) embedUrl += 'bvid=' + bvid;
            else if (aid) embedUrl += 'aid=' + aid;
            if (extraParams) embedUrl += extraParams;
            if (!extraParams.includes('page=')) embedUrl += '&page=1';
            return '<iframe src="' + embedUrl + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });
        // 2. 通用嵌入：![](embed:url)
        text = text.replace(/!\[\]\(embed:([^)]+)\)/g, function(match, url) {
            return '<iframe src="' + url + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });
        // 3. [bilibili]BVxxx[/bilibili]
        text = text.replace(/\[bilibili\](BV[a-zA-Z0-9]+)\[\/bilibili\]/g, function(m, bvid) {
            return '<iframe src="https://player.bilibili.com/player.html?bvid=' + bvid + '&page=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });
        // 4. align 语法
        text = text.replace(/:::align\{center\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_CENTER%%$1%%ALIGN_END%%');
        text = text.replace(/:::align\{right\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_RIGHT%%$1%%ALIGN_END%%');
        return text;
    }

    // ---------- 解析嵌套折叠框 ----------
    function parseNestedDetails(text) {
        var lines = text.split('\n');
        var output = [];
        var stack = [];
        var roots = [];
        var i = 0;
        while (i < lines.length) {
            var rawLine = lines[i];
            var trimmed = rawLine.trim();
            var startMatch = null;
            if (trimmed.startsWith(':::')) {
                var colonsCount = 0;
                while (colonsCount < trimmed.length && trimmed[colonsCount] === ':') colonsCount++;
                if (colonsCount >= 3) {
                    var rest = trimmed.slice(colonsCount).trim();
                    var typeMatch = rest.match(/^([a-zA-Z0-9]+)/);
                    if (typeMatch) {
                        var type = typeMatch[1];
                        var title = '', openAttr = '';
                        var remaining = rest.slice(type.length).trim();
                        var titleMatch = remaining.match(/^\[([^\]]*)\]/);
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
                            startMatch = { colonsCount: colonsCount, type: type, title: title, openAttr: openAttr };
                        }
                    }
                }
            }
            if (startMatch && ['info','success','warning','error'].indexOf(startMatch.type) !== -1) {
                var node = {
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
            var endMatch = null;
            if (trimmed.startsWith(':::')) {
                var colonsCount2 = 0;
                while (colonsCount2 < trimmed.length && trimmed[colonsCount2] === ':') colonsCount2++;
                if (colonsCount2 >= 3 && trimmed.slice(colonsCount2).trim() === '') {
                    endMatch = { colonsCount: colonsCount2 };
                }
            }
            if (endMatch && stack.length > 0) {
                var top = stack[stack.length - 1];
                if (endMatch.colonsCount === top.colonsCount) {
                    var node2 = stack.pop();
                    if (stack.length === 0) {
                        var idx = roots.length;
                        roots.push(node2);
                        output.push('%%DETAILS_ROOT_' + idx + '%%');
                    } else {
                        stack[stack.length - 1].children.push(node2);
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
            var node3 = stack.pop();
            var idx2 = roots.length;
            roots.push(node3);
            output.push('%%DETAILS_ROOT_' + idx2 + '%%');
        }
        return { roots: roots, output: output.join('\n') };
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

        // 解析嵌套折叠框
        var parsed = parseNestedDetails(rawText);
        var detailRoots = parsed.roots;
        rawText = parsed.output;

        // 提取 Mermaid 代码块
        var mermaidBlocks = [];
        rawText = rawText.replace(/```mermaid\s*([\s\S]*?)```/g, function(match, code) {
            var idx = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
            return '%%MERMAID_' + idx + '%%';
        });

        // ---------- 逐行提取围栏代码块 ----------
        var lines = rawText.split('\n');
        var blocks = [];
        var processedLines = [];
        var inFence = false, fenceContent = [], blockIdx = 0;
        for (var i2 = 0; i2 < lines.length; i2++) {
            var line = lines[i2];
            var prefixMatch = line.match(/^(>\s*)+/);
            var prefix = prefixMatch ? prefixMatch[0] : '';
            var cleanLine = line.replace(/^(>\s?)+/, '');
            if (!inFence && cleanLine.startsWith('```')) {
                inFence = true;
                fenceContent = [cleanLine];
                processedLines.push(prefix + '%%BLOCK' + blockIdx + '%%');
            } else if (inFence) {
                fenceContent.push(cleanLine);
                if (cleanLine.trim() === '```') {
                    inFence = false;
                    var content = fenceContent.join('\n');
                    var firstLine = fenceContent[0] || '';
                    var lang = '', filename = '';
                    if (firstLine.startsWith('```')) {
                        var params = firstLine.slice(3).trim();
                        var parts = params.split(/\s+/);
                        var firstPart = parts[0] || '';
                        if (firstPart.indexOf(':') !== -1) {
                            var splitParts = firstPart.split(':');
                            lang = splitParts[0];
                            filename = splitParts.slice(1).join(':');
                        } else {
                            lang = firstPart;
                        }
                    }
                    blocks.push({ type: 'fence', content: content, filename: filename, lang: lang });
                    blockIdx++;
                }
            } else {
                processedLines.push(line);
            }
        }
        if (inFence && fenceContent.length > 0) {
            var content2 = fenceContent.join('\n');
            var firstLine2 = fenceContent[0] || '';
            var lang2 = '', filename2 = '';
            if (firstLine2.startsWith('```')) {
                var params2 = firstLine2.slice(3).trim();
                var parts2 = params2.split(/\s+/);
                var firstPart2 = parts2[0] || '';
                if (firstPart2.indexOf(':') !== -1) {
                    var splitParts2 = firstPart2.split(':');
                    lang2 = splitParts2[0];
                    filename2 = splitParts2.slice(1).join(':');
                } else {
                    lang2 = firstPart2;
                }
            }
            blocks.push({ type: 'fence', content: content2, filename: filename2, lang: lang2 });
            blockIdx++;
        }
        var processed = processedLines.join('\n');

        // ---------- 提取内联代码 ----------
        processed = processed.replace(/`([^`]+)`/g, function(match, code) {
            if (/^%%BLOCK\d+%%$/.test(match)) return match;
            var idx = blocks.length;
            var safeCode = code.replace(/\n/g, '&#10;');
            blocks.push({ type: 'inline', content: safeCode });
            return '%%BLOCK' + idx + '%%';
        });

        // ---------- 洛谷扩展 ----------
        processed = preprocessLuoguSyntax(processed);

        // ---------- LaTeX 渲染 ----------
        if (window.katex) {
            processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, function(match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return '<div style="text-align:center;margin:8px 0;">' +
                        window.katex.renderToString(realMath, { displayMode: true, throwOnError: false }) +
                        '</div>';
                } catch (e) { return match; }
            });
            processed = processed.replace(/\$([^$]+?)\$/g, function(match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return window.katex.renderToString(realMath, { throwOnError: false });
                } catch (e) { return match; }
            });
        }

        // ---------- 图片尺寸 ----------
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x(\d*)\)/g, function(match, alt, url, width, height) {
            var style = 'width:' + width + 'px;' + (height ? ' height:' + height + 'px;' : '');
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="' + style + '">';
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x\)/g, function(match, alt, url, width) {
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="width:' + width + 'px; height:auto;">';
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*x(\d+)\)/g, function(match, alt, url, height) {
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="height:' + height + 'px; width:auto;">';
        });

        // ---------- 扩展语法 ----------
        processed = processed.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        processed = processed.replace(/==([^=]+)==/g, '<mark>$1</mark>');
        processed = processed.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
        processed = processed.replace(/(?<![:\-])--([^-]+)--(?![:\-])/g, '<small>$1</small>');
        processed = processed.replace(/(?<![\[\^])\^([^^]+)\^(?![\]])/g, '<sup>$1</sup>');
        processed = processed.replace(/~([^~]+)~/g, '<sub>$1</sub>');
        processed = processed.replace(/\[\[TOC\]\]/g, '%%TOC_PLACEHOLDER%%');
        processed = processed.replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>');
        processed = processed.replace(/%%TOC_PLACEHOLDER%%/g, '[[TOC]]');

        // ---------- 管理员专属语法 ----------
        if (isAdmin) {
            processed = processed.replace(/\[admin\]([\s\S]*?)\[\/admin\]/g, function(match, content) {
                return '<blockquote class="admin-public-comment"><p>管理组提示：</p><div class="lfe-marked-wrap"><div class="lfe-marked">' + content + '</div></div></blockquote>';
            });
            processed = processed.replace(/\{rainbow\}([\s\S]*?)\{rainbow\}/g, function(match, content) {
                var chars = content.split('');
                var len = chars.length;
                if (len === 0) return '';
                var startHue = 0, endHue = 300;
                var result = '';
                for (var i = 0; i < len; i++) {
                    var hue = startHue + (endHue - startHue) * (i / (len - 1));
                    result += '<span style="color:hsl(' + hue + ', 100%, 50%);">' + chars[i] + '</span>';
                }
                return '<span style="font-weight:bold;">' + result + '</span>';
            });
            processed = processed.replace(/\[sign\]([\s\S]*?)\[\/sign\]/g, function(match, content) {
                return '<div class="signature-block">' + content + '<div class="signature-name">—— ✨ Jason227 高贵的用户：' + escapeHtmlAttr(username) + '</div></div>';
            });
        }

        // ---------- markdown-it 渲染 ----------
        var html = md.render(processed);

        // ---------- 脚注唯一ID前缀 ----------
        if (uniqueId) {
            html = html.replace(/\bid="(fn|fnref)(\d+)"/g, 'id="' + uniqueId + '-$1$2"');
            html = html.replace(/href="#(fn|fnref)(\d+)"/g, 'href="#' + uniqueId + '-$1$2"');
        }

        // ---------- 生成目录 ----------
        function generateTOC(htmlText) {
            var parser = new DOMParser();
            var doc = parser.parseFromString(htmlText, 'text/html');
            var body = doc.body;
            var headers = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
            if (headers.length === 0) return htmlText;
            var idCounter = 0;
            var tocItems = [];
            headers.forEach(function(el) {
                var id = el.getAttribute('id');
                if (!id) {
                    id = uniqueId ? uniqueId + '-toc-' + idCounter++ : 'toc-' + idCounter++;
                    el.setAttribute('id', id);
                }
                var text = el.textContent.trim();
                tocItems.push({ level: parseInt(el.tagName[1]), id: id, text: text });
            });
            if (tocItems.length === 0) return htmlText;
            var tocHtml = '<div class="toc"><ul>';
            var currentLevel = 0;
            for (var i3 = 0; i3 < tocItems.length; i3++) {
                var item = tocItems[i3];
                var level = item.level;
                if (level > currentLevel) {
                    for (var j = 0; j < level - currentLevel; j++) tocHtml += '<ul>';
                } else if (level < currentLevel) {
                    for (var j2 = 0; j2 < currentLevel - level; j2++) tocHtml += '</ul>';
                }
                tocHtml += '<li><a href="#' + item.id + '">' + item.text + '</a></li>';
                currentLevel = level;
            }
            while (currentLevel > 1) { tocHtml += '</ul>'; currentLevel--; }
            tocHtml += '</ul></div>';
            var newHtml = body.innerHTML;
            newHtml = newHtml.replace(/\[\[TOC\]\]/g, tocHtml);
            return newHtml;
        }
        html = generateTOC(html);

        // ---------- 恢复 Mermaid ----------
        html = html.replace(/%%MERMAID_(\d+)%%/g, function(match, idx) {
            var code = mermaidBlocks[parseInt(idx)];
            if (!code) return match;
            return '<div class="mermaid">' + code + '</div>';
        });

        // ---------- 渲染折叠框（递归） ----------
        function renderLatex(text) {
            if (!text || !window.katex) return text;
            text = text.replace(/\$\$([\s\S]+?)\$\$/g, function(match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return '<div style="text-align:center;margin:8px 0;">' +
                        window.katex.renderToString(realMath, { displayMode: true, throwOnError: false }) +
                        '</div>';
                } catch (e) { return match; }
            });
            text = text.replace(/\$([^$]+?)\$/g, function(match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return window.katex.renderToString(realMath, { throwOnError: false });
                } catch (e) { return match; }
            });
            return text;
        }

        function renderDetailsNode(node) {
            var content = node.contentLines.join('\n');
            content = renderLatex(content);
            var renderedContent = md.render(content);
            var title = renderLatex(node.title);
            var renderedTitle = md.renderInline(title);
            var childrenHtml = '';
            for (var i4 = 0; i4 < node.children.length; i4++) {
                childrenHtml += renderDetailsNode(node.children[i4]);
            }
            var openAttr = node.openAttr && node.openAttr.trim() === 'open' ? ' open' : '';
            return '<details class="' + escapeHtmlAttr(node.type) + '"' + openAttr + '><summary>' + renderedTitle + '</summary>' + renderedContent + childrenHtml + '</details>';
        }

        html = html.replace(/%%DETAILS_ROOT_(\d+)%%/g, function(match, idx) {
            var node = detailRoots[parseInt(idx)];
            if (!node) return match;
            return renderDetailsNode(node);
        });

        // ---------- 处理对齐占位符 ----------
        html = html.replace(/%%ALIGN_CENTER%%([\s\S]*?)%%ALIGN_END%%/g, function(match, content) {
            var rendered = md.render(content);
            return '<div class="align-center">' + rendered + '</div>';
        });
        html = html.replace(/%%ALIGN_RIGHT%%([\s\S]*?)%%ALIGN_END%%/g, function(match, content) {
            var rendered = md.render(content);
            return '<div class="align-right">' + rendered + '</div>';
        });

        // ---------- 修复中文引号 ----------
        html = html.replace(/“/g, '"').replace(/”/g, '"');

        // ---------- 恢复代码块 ----------
        html = html.replace(/%%BLOCK(\d+)%%/g, function(match, idx) {
            var block = blocks[parseInt(idx)];
            if (!block) return '';
            if (block.type === 'inline') {
                return '<code>' + escapeHtml(block.content) + '</code>';
            }
            var lines2 = block.content.split('\n');
            var firstLine3 = lines2[0];
            var lang3 = '', showLineNumbers = false, showHighlight = false, highlightLines = null;
            if (firstLine3.startsWith('```')) {
                var params3 = firstLine3.slice(3).trim();
                var parts3 = params3.split(/\s+/);
                lang3 = parts3[0] || '';
                if (params3.indexOf('line-numbers') !== -1) showLineNumbers = true;
                var linesMatch = params3.match(/lines=(\d+)-(\d+)/);
                if (linesMatch) {
                    showHighlight = true;
                    highlightLines = { start: parseInt(linesMatch[1]), end: parseInt(linesMatch[2]) };
                }
            }
            var codeContent = lines2.slice(1, -1).join('\n');
            var titleHtml = '';
            if (block.filename) {
                titleHtml = '<div class="code-filename">' + escapeHtml(block.filename) + '</div>';
            }
            var codeHtml = '';
            if (!showLineNumbers && !showHighlight) {
                var codeLines = codeContent.split('\n');
                if (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
                codeHtml = '<pre><code class="language-' + lang3 + '">';
                for (var i5 = 0; i5 < codeLines.length; i5++) {
                    var lineContent = codeLines[i5] || ' ';
                    codeHtml += '<div class="code-line"><span class="code-text">' + escapeHtml(lineContent) + '</span></div>';
                }
                codeHtml += '</code></pre>';
            } else {
                var codeLines2 = codeContent.split('\n');
                if (codeLines2.length > 0 && codeLines2[codeLines2.length - 1] === '') codeLines2.pop();
                var totalLines = codeLines2.length;
                var maxDigits = String(totalLines).length;
                codeHtml = '<pre><code>';
                for (var i6 = 0; i6 < totalLines; i6++) {
                    var lineNum = i6 + 1;
                    var lineContent2 = codeLines2[i6] || ' ';
                    var lineClass = '';
                    if (showHighlight && highlightLines && lineNum >= highlightLines.start && lineNum <= highlightLines.end) {
                        lineClass = ' code-highlight-line';
                    }
                    codeHtml += '<div class="code-line' + lineClass + '">';
                    if (showLineNumbers) {
                        codeHtml += '<span class="line-number" style="min-width:' + (maxDigits + 1) + 'ch;">' + lineNum + '</span>';
                    }
                    codeHtml += '<span class="code-text">' + escapeHtml(lineContent2) + '</span>';
                    codeHtml += '</div>';
                }
                codeHtml += '</code></pre>';
            }
            return titleHtml +
                '<div class="code-block-wrapper">' +
                '<button class="copy-code-btn" data-copy-btn title="复制代码">' +
                '<svg class="svg-icon" viewBox="0 0 448 512" aria-hidden="true">' +
                '<path d="M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z"/>' +
                '</svg>' +
                '</button>' +
                codeHtml +
                '</div>';
        });

        // ---------- @提及 ----------
        html = html.replace(/@([\u4e00-\u9fa5a-zA-Z0-9_.-]+)/g, function(match, username) {
            var uid = mentionMap && mentionMap[username];
            if (uid)
                return '@<a href="/user/' + uid + '" class="mention-link" style="color:#e74c3c; text-decoration:none;">' + escapeHtmlAttr(username) + '</a>';
            return match;
        });

        // ---------- 清理 ----------
        html = html.replace(/<p><\/p>\s*$/, '').replace(/<br\s*\/?>\s*$/, '').trim();
        html = html.replace(/<p>\s*<\/p>/g, '').replace(/:\s*$/gm, '');

        // ---------- DOMPurify 安全过滤 ----------
        if (window.DOMPurify) {
            html = window.DOMPurify.sanitize(html, {
                ADD_TAGS: ['iframe', 'section', 'ol', 'li', 'sup', 'sub', 'mark', 'ins', 'small', 'kbd', 'del', 'div'],
                ADD_ATTR: ['src', 'width', 'height', 'scrolling', 'border', 'frameborder', 'framespacing',
                           'allowfullscreen', 'style', 'id', 'class', 'href', 'open']
            });
        }

        return html;
    }

    // ---------- 复制代码功能 ----------
    function showCopyToast() {
        var toast = document.querySelector('.swal2-toast-copy');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'swal2-toast-copy';
            toast.innerHTML =
                '<svg class="success-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#a5dc86" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="20 6 9 17 4 12" /></svg>' +
                '<h2 class="swal2-title-copy">Contents copied!</h2>';
            document.body.appendChild(toast);
        } else {
            toast.classList.remove('show');
            void toast.offsetWidth;
        }
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(function() {
            toast.classList.remove('show');
        }, 2000);
    }

    function copyCode(btn) {
        var wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        var pre = wrapper.querySelector('pre');
        if (!pre) return;
        var codeTexts = pre.querySelectorAll('.code-text');
        var code = '';
        codeTexts.forEach(function(el) { code += el.textContent + '\n'; });
        code = code.replace(/\n$/, '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(function() {
                showCopyToast();
            }).catch(function() {
                fallbackCopy(code);
            });
        } else {
            fallbackCopy(code);
        }
    }

    function fallbackCopy(text) {
        var textarea = document.createElement('textarea');
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

    // ---------- 暴露 API ----------
    window.renderContent = renderContent;
    window.copyCode = copyCode;

    // 自动为页面中的 .mermaid 元素初始化 Mermaid（如果存在）
    if (window.mermaid) {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() {
                window.mermaid.initialize({
                    theme: 'default',
                    themeVariables: {
                        background: '#ffffff',
                        primaryColor: '#e74c3c',
                        primaryTextColor: '#333',
                        primaryBorderColor: '#ccc',
                        lineColor: '#666',
                        secondaryColor: '#f0f2f5',
                        tertiaryColor: '#f9f9f9'
                    },
                    startOnLoad: false
                });
                window.mermaid.run({ nodes: document.querySelectorAll('.mermaid') })
                    .catch(function(err) { console.warn('Mermaid 渲染警告:', err); });
            }, 200);
        });
    }

})();