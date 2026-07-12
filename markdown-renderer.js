/**
 * markdown-renderer.js
 * 
 * 独立 Markdown 渲染器，支持：
 * - 标准 Markdown（markdown-it + 插件）
 * - LaTeX 公式（KaTeX）
 * - 代码块行号、高亮、文件名、复制按钮
 * - 自定义语法：删除线、高亮、下标、上标、键盘按键、对齐、Bilibili 嵌入、折叠框、目录等
 * - 管理员专属语法：[admin]、{rainbow}、[sign]
 * - Mermaid 图表
 * - @提及
 * - 脚注锚点隔离
 * 
 * 依赖（需提前加载）：
 *   - KaTeX CSS & JS
 *   - markdown-it 及 task-lists, emoji, footnote, deflist, abbr 插件
 *   - DOMPurify
 *   - Mermaid（可选）
 * 
 * 用法：
 *   1. 单个渲染： const html = MarkdownRenderer.renderContent(raw, mentionMap, isAdmin, username, uniqueId);
 *   2. 批量渲染页面中所有 .benben-text 元素：
 *      const profile = { is_admin: true, username: '管理员' };
 *      MarkdownRenderer.renderAllBenbenTexts(profile);
 */

(function (global) {
    'use strict';

    // ============================================================
    // 1. 依赖检查
    // ============================================================
    if (typeof global.markdownit !== 'function') {
        throw new Error('[markdown-renderer] markdown-it 未加载，请先引入 markdown-it 库。');
    }
    if (typeof global.katex === 'undefined') {
        console.warn('[markdown-renderer] KaTeX 未加载，LaTeX 公式将无法渲染。');
    }
    if (typeof global.DOMPurify === 'undefined') {
        throw new Error('[markdown-renderer] DOMPurify 未加载，请先引入。');
    }

    // ============================================================
    // 2. 工具函数
    // ============================================================
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

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

    function htmlDecode(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.innerHTML = str;
        return div.textContent;
    }

    // 系统默认头像（首字母 SVG）
    function letterAvatar(name) {
        var ch = (name || 'U').trim().charAt(0).toUpperCase() || 'U';
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%23e74c3c'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-size='16' font-family='Arial'%3E" + encodeURIComponent(ch) + "%3C/text%3E%3C/svg%3E";
    }

    // ============================================================
    // 3. markdown-it 实例（带插件）
    // ============================================================
    var md = global.markdownit({
        html: true,
        linkify: true,
        typographer: true
    });

    // 加载插件（确保插件已在页面中加载）
    if (typeof global.markdownitTaskLists === 'function') {
        md.use(global.markdownitTaskLists);
    }
    if (typeof global.markdownitEmoji === 'function') {
        md.use(global.markdownitEmoji);
    }
    if (typeof global.markdownitFootnote === 'function') {
        md.use(global.markdownitFootnote);
    }
    if (typeof global.markdownitDeflist === 'function') {
        md.use(global.markdownitDeflist);
    }
    if (typeof global.markdownitAbbr === 'function') {
        md.use(global.markdownitAbbr);
    }

    // ============================================================
    // 4. 核心渲染函数
    // ============================================================
    function renderContent(rawText, mentionMap, isAdmin, username, uniqueId) {
        if (!rawText) return '';

        // 0. 解码 HTML 实体
        rawText = rawText
            .replace(/&gt;/g, '>')
            .replace(/&lt;/g, '<')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');

        // 解析嵌套折叠框（树形结构）
        var _parseResult = parseNestedDetails(rawText);
        var detailRoots = _parseResult.roots;
        var processedText = _parseResult.output;

        // 提取 Mermaid 代码块
        var mermaidBlocks = [];
        processedText = processedText.replace(/```mermaid\s*([\s\S]*?)```/g, function (match, code) {
            var idx = mermaidBlocks.length;
            mermaidBlocks.push(code.trim());
            return '%%MERMAID_' + idx + '%%';
        });

        // ========== 1. 逐行提取围栏代码块（保留引用前缀） ==========
        var lines = processedText.split('\n');
        var blocks = [];
        var processedLines = [];
        var inFence = false;
        var fenceContent = [];
        var blockIdx = 0;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
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
                    var lang = '',
                        filename = '';
                    if (firstLine.startsWith('```')) {
                        var params = firstLine.slice(3).trim();
                        var parts = params.split(/\s+/);
                        var firstPart = parts[0] || '';
                        if (firstPart.includes(':')) {
                            var parts2 = firstPart.split(':');
                            lang = parts2[0];
                            filename = parts2.slice(1).join(':');
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
            var lang2 = '',
                filename2 = '';
            if (firstLine2.startsWith('```')) {
                var params2 = firstLine2.slice(3).trim();
                var parts3 = params2.split(/\s+/);
                var firstPart2 = parts3[0] || '';
                if (firstPart2.includes(':')) {
                    var parts4 = firstPart2.split(':');
                    lang2 = parts4[0];
                    filename2 = parts4.slice(1).join(':');
                } else {
                    lang2 = firstPart2;
                }
            }
            blocks.push({ type: 'fence', content: content2, filename: filename2, lang: lang2 });
            blockIdx++;
        }
        var processed = processedLines.join('\n');

        // ========== 2. 提取内联代码 ==========
        processed = processed.replace(/`([^`]+)`/g, function (match, code) {
            if (/^%%BLOCK\d+%%$/.test(match)) return match;
            var idx = blocks.length;
            var safeCode = code.replace(/\n/g, '&#10;');
            blocks.push({ type: 'inline', content: safeCode });
            return '%%BLOCK' + idx + '%%';
        });

        // ========== 3. 洛谷扩展（Bilibili 简写等） ==========
        processed = preprocessLuoguSyntax(processed);

        // ========== 4. LaTeX 渲染 ==========
        if (global.katex) {
            processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, function (match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return '<div style="text-align:center;margin:8px 0;">' + global.katex.renderToString(realMath, { displayMode: true, throwOnError: false }) + '</div>';
                } catch (e) { return match; }
            });
            processed = processed.replace(/\$([^$]+?)\$/g, function (match, math) {
                var realMath = math.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                try {
                    return global.katex.renderToString(realMath, { throwOnError: false });
                } catch (e) { return match; }
            });
        }

        // 图片尺寸控制
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x(\d*)\)/g, function (match, alt, url, width, height) {
            var style = 'width:' + width + 'px;' + (height ? ' height:' + height + 'px;' : '');
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="' + style + '">';
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*(\d+)x\)/g, function (match, alt, url, width) {
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="width:' + width + 'px; height:auto;">';
        });
        processed = processed.replace(/!\[([^\]]*)\]\(([^)]+?)\s*=\s*x(\d+)\)/g, function (match, alt, url, height) {
            return '<img alt="' + escapeHtmlAttr(alt) + '" src="' + escapeHtmlAttr(url) + '" style="height:' + height + 'px; width:auto;">';
        });

        // 删除线、高亮、插入、小号
        processed = processed.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        processed = processed.replace(/==([^=]+)==/g, '<mark>$1</mark>');
        processed = processed.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
        processed = processed.replace(/(?<![:\-])--([^-]+)--(?![:\-])/g, '<small>$1</small>');

        // 上标、下标
        processed = processed.replace(/(?<![\[\^])\^([^^]+)\^(?![\]])/g, '<sup>$1</sup>');
        processed = processed.replace(/~([^~]+)~/g, '<sub>$1</sub>');

        // 键盘按键
        processed = processed.replace(/\[\[TOC\]\]/g, '%%TOC_PLACEHOLDER%%');
        processed = processed.replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>');
        processed = processed.replace(/%%TOC_PLACEHOLDER%%/g, '[[TOC]]');

        // 管理员专属语法
        if (isAdmin) {
            processed = processed.replace(/\[admin\]([\s\S]*?)\[\/admin\]/g, function (match, content) {
                return '<blockquote class="admin-public-comment"><p>管理组提示：</p><div class="lfe-marked-wrap"><div class="lfe-marked">' + content + '</div></div></blockquote>';
            });
            processed = processed.replace(/\{rainbow\}([\s\S]*?)\{rainbow\}/g, function (match, content) {
                var chars = content.split('');
                var len = chars.length;
                if (len === 0) return '';
                var startHue = 0,
                    endHue = 300;
                var result = '';
                for (var j = 0; j < len; j++) {
                    var hue = startHue + (endHue - startHue) * (j / (len - 1));
                    result += '<span style="color:hsl(' + hue + ', 100%, 50%);">' + chars[j] + '</span>';
                }
                return '<span style="font-weight:bold;">' + result + '</span>';
            });
            processed = processed.replace(/\[sign\]([\s\S]*?)\[\/sign\]/g, function (match, content) {
                return '<div class="signature-block">' + content + '<div class="signature-name">—— ✨ Jason227 高贵的用户：' + escapeHtmlAttr(username || '用户') + '</div></div>';
            });
        }

        var html = md.render(processed);

        // 脚注锚点隔离
        if (uniqueId) {
            html = html.replace(/\bid="(fn|fnref)(\d+)"/g, 'id="' + uniqueId + '-$1$2"');
            html = html.replace(/href="#(fn|fnref)(\d+)"/g, 'href="#' + uniqueId + '-$1$2"');
        }

        // 生成目录
        html = generateTOC(html, uniqueId);

        // 恢复 Mermaid
        html = html.replace(/%%MERMAID_(\d+)%%/g, function (match, idx) {
            var code = mermaidBlocks[parseInt(idx)];
            if (!code) return match;
            return '<div class="mermaid">' + code + '</div>';
        });

        // 处理折叠框（树形结构）
        html = html.replace(/%%DETAILS_ROOT_(\d+)%%/g, function (match, idx) {
            var node = detailRoots[parseInt(idx)];
            if (!node) return match;
            return renderDetailsNode(node);
        });

        // 处理对齐占位符
        html = html.replace(/%%ALIGN_CENTER%%([\s\S]*?)%%ALIGN_END%%/g, function (match, content) {
            var rendered = md.render(content);
            return '<div class="align-center">' + rendered + '</div>';
        });
        html = html.replace(/%%ALIGN_RIGHT%%([\s\S]*?)%%ALIGN_END%%/g, function (match, content) {
            var rendered = md.render(content);
            return '<div class="align-right">' + rendered + '</div>';
        });

        // 修复 KaTeX 引号
        html = html.replace(/“/g, '"').replace(/”/g, '"');

        // 恢复代码块
        html = html.replace(/%%BLOCK(\d+)%%/g, function (match, idx) {
            var block = blocks[parseInt(idx)];
            if (!block) return '';

            if (block.type === 'inline') {
                return '<code>' + escapeHtml(block.content) + '</code>';
            }

            // 围栏代码块
            var lines2 = block.content.split('\n');
            var firstLine3 = lines2[0];
            var lang3 = '',
                showLineNumbers = false,
                showHighlight = false,
                highlightLines = null;
            if (firstLine3.startsWith('```')) {
                var params3 = firstLine3.slice(3).trim();
                var parts5 = params3.split(/\s+/);
                lang3 = parts5[0] || '';
                if (params3.includes('line-numbers')) showLineNumbers = true;
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
            var codeLinesArr = codeContent.split('\n');
            if (codeLinesArr.length > 0 && codeLinesArr[codeLinesArr.length - 1] === '') codeLinesArr.pop();
            var totalLines = codeLinesArr.length;
            var maxDigits = String(totalLines).length;

            codeHtml = '<pre><code>';
            for (var k = 0; k < totalLines; k++) {
                var lineNum = k + 1;
                var lineContent = codeLinesArr[k] || ' ';
                var lineClass = '';
                if (showHighlight && highlightLines && lineNum >= highlightLines.start && lineNum <= highlightLines.end) {
                    lineClass = ' code-highlight-line';
                }
                codeHtml += '<div class="code-line' + lineClass + '">';
                if (showLineNumbers) {
                    codeHtml += '<span class="line-number" style="min-width:' + (maxDigits + 1) + 'ch;">' + lineNum + '</span>';
                }
                codeHtml += '<span class="code-text">' + escapeHtml(lineContent) + '</span>';
                codeHtml += '</div>';
            }
            codeHtml += '</code></pre>';

            return titleHtml + '<div class="code-block-wrapper">' +
                '<button class="copy-code-btn" data-copy-btn title="复制代码">' +
                '<svg class="svg-icon" viewBox="0 0 448 512" aria-hidden="true" width="16" height="16" fill="currentColor">' +
                '<path d="M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z"/>' +
                '</svg></button>' + codeHtml + '</div>';
        });

        // @提及
        html = html.replace(/@([\u4e00-\u9fa5a-zA-Z0-9_.-]+)/g, function (match, username2) {
            var uid = mentionMap && mentionMap[username2];
            if (uid) return '@<a href="/user/' + uid + '" class="mention-link" style="color:#e74c3c; text-decoration:none;">' + escapeHtmlAttr(username2) + '</a>';
            return match;
        });

        // 清理多余段落
        html = html.replace(/<p><\/p>\s*$/, '').replace(/<br\s*\/?>\s*$/, '').trim();
        html = html.replace(/<p>\s*<\/p>/g, '').replace(/:\s*$/gm, '');

        // 安全过滤
        return global.DOMPurify.sanitize(html, {
            ADD_TAGS: ['iframe', 'section', 'ol', 'li', 'sup', 'sub', 'mark', 'ins', 'small', 'kbd', 'del', 'div', 'details', 'summary'],
            ADD_ATTR: ['src', 'width', 'height', 'scrolling', 'border', 'frameborder', 'framespacing',
                'allowfullscreen', 'style', 'id', 'class', 'href', 'open'
            ]
        });
    }

    // ============================================================
    // 5. 辅助解析函数
    // ============================================================
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
                        var title = '';
                        var openAttr = '';
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

            if (startMatch && ['info', 'success', 'warning', 'error'].indexOf(startMatch.type) !== -1) {
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
                var endColons = 0;
                while (endColons < trimmed.length && trimmed[endColons] === ':') endColons++;
                if (endColons >= 3 && trimmed.slice(endColons).trim() === '') {
                    endMatch = { colonsCount: endColons };
                }
            }

            if (endMatch && stack.length > 0) {
                var top = stack[stack.length - 1];
                if (endMatch.colonsCount === top.colonsCount) {
                    var popped = stack.pop();
                    if (stack.length === 0) {
                        var idx = roots.length;
                        roots.push(popped);
                        output.push('%%DETAILS_ROOT_' + idx + '%%');
                    } else {
                        stack[stack.length - 1].children.push(popped);
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
            var leftover = stack.pop();
            var idx2 = roots.length;
            roots.push(leftover);
            output.push('%%DETAILS_ROOT_' + idx2 + '%%');
        }

        return { roots: roots, output: output.join('\n') };
    }

    function renderDetailsNode(node) {
        var content = node.contentLines.join('\n');
        // 对内容进行 LaTeX 渲染（在 renderContent 中已做，但此处嵌套内容也需要，但我们直接调用 md.render）
        var renderedContent = md.render(content);
        var title = node.title;
        var renderedTitle = md.renderInline(title);
        var childrenHtml = node.children.map(function (child) { return renderDetailsNode(child); }).join('');
        var openAttr = node.openAttr && node.openAttr.trim() === 'open' ? ' open' : '';
        return '<details class="' + escapeHtmlAttr(node.type) + '"' + openAttr + '><summary>' + renderedTitle + '</summary>' + renderedContent + childrenHtml + '</details>';
    }

    // ============================================================
    // 6. 目录生成
    // ============================================================
    function generateTOC(htmlText, uniqueId) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(htmlText, 'text/html');
        var body = doc.body;

        var headers = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headers.length === 0) return htmlText;

        var idCounter = 0;
        var tocItems = [];

        headers.forEach(function (el, index) {
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
        for (var i = 0; i < tocItems.length; i++) {
            var item = tocItems[i];
            var level = item.level;
            if (level > currentLevel) {
                for (var j = 0; j < level - currentLevel; j++) tocHtml += '<ul>';
            } else if (level < currentLevel) {
                for (var j = 0; j < currentLevel - level; j++) tocHtml += '</ul>';
            }
            tocHtml += '<li><a href="#' + item.id + '">' + item.text + '</a></li>';
            currentLevel = level;
        }
        while (currentLevel > 1) {
            tocHtml += '</ul>';
            currentLevel--;
        }
        tocHtml += '</ul></div>';

        var newHtml = body.innerHTML;
        newHtml = newHtml.replace(/\[\[TOC\]\]/g, tocHtml);
        return newHtml;
    }

    // ============================================================
    // 7. 洛谷扩展预处理
    // ============================================================
    function preprocessLuoguSyntax(text) {
        text = text.replace(/!\[\]\(bilibili:([^)]+)\)/g, function (match, param) {
            var bvid = '';
            var aid = '';
            var extraParams = '';

            var queryIndex = param.indexOf('?');
            var base = param;
            if (queryIndex !== -1) {
                base = param.substring(0, queryIndex);
                extraParams = param.substring(queryIndex);
                extraParams = extraParams.replace(/^\?/, '&');
            }

            var lowerBase = base.toLowerCase();
            if (lowerBase.startsWith('bv')) {
                bvid = base;
            } else if (lowerBase.startsWith('av')) {
                aid = base.substring(2);
            } else if (/^\d+$/.test(base)) {
                aid = base;
            } else {
                return match;
            }

            var embedUrl = 'https://player.bilibili.com/player.html?';
            if (bvid) embedUrl += 'bvid=' + bvid;
            else if (aid) embedUrl += 'aid=' + aid;
            if (extraParams) embedUrl += extraParams;
            if (!extraParams.includes('page=')) embedUrl += '&page=1';

            return '<iframe src="' + embedUrl + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });

        text = text.replace(/!\[\]\(embed:([^)]+)\)/g, function (match, url) {
            return '<iframe src="' + url + '" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });

        text = text.replace(/\[bilibili\](BV[a-zA-Z0-9]+)\[\/bilibili\]/g, function (m, bvid) {
            return '<iframe src="https://player.bilibili.com/player.html?bvid=' + bvid + '&page=1" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" style="width:100%; height:360px;"></iframe>';
        });

        text = text.replace(/:::align\{center\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_CENTER%%$1%%ALIGN_END%%');
        text = text.replace(/:::align\{right\}\s*([\s\S]*?)\n:::/gm, '%%ALIGN_RIGHT%%$1%%ALIGN_END%%');

        return text;
    }

    // ============================================================
    // 8. Mermaid 渲染
    // ============================================================
    function renderMermaid() {
        if (typeof global.mermaid === 'undefined') return;
        global.mermaid.initialize({
            theme: 'default',
            startOnLoad: false,
            themeVariables: {
                background: '#ffffff',
                primaryColor: '#e74c3c',
                primaryTextColor: '#333',
                primaryBorderColor: '#ccc',
                lineColor: '#666',
                secondaryColor: '#f0f2f5',
                tertiaryColor: '#f9f9f9'
            }
        });
        requestAnimationFrame(function () {
            global.mermaid.run({
                nodes: document.querySelectorAll('.mermaid')
            }).catch(function (err) { console.warn('Mermaid 渲染失败:', err); });
        });
    }

    // ============================================================
    // 9. 复制代码功能
    // ============================================================
    function showCopyToast() {
        var toast = document.querySelector('.swal2-toast-copy');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'swal2-toast-copy';
            toast.innerHTML =
                '<svg class="success-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#a5dc86" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>' +
                '<h2 class="swal2-title-copy">Contents copied!</h2>';
            document.body.appendChild(toast);
        } else {
            toast.classList.remove('show');
            void toast.offsetWidth;
        }
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(function () {
            toast.classList.remove('show');
        }, 2000);
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

    function copyCode(btn) {
        var wrapper = btn.closest('.code-block-wrapper');
        if (!wrapper) return;
        var pre = wrapper.querySelector('pre');
        if (!pre) return;

        var codeTexts = pre.querySelectorAll('.code-text');
        var code = '';
        codeTexts.forEach(function (el) {
            code += el.textContent + '\n';
        });
        code = code.replace(/\n$/, '');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(function () {
                showCopyToast();
            }).catch(function () {
                fallbackCopy(code);
            });
        } else {
            fallbackCopy(code);
        }
    }

    // 全局事件委托：监听复制按钮点击
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('.copy-code-btn');
        if (btn) {
            e.preventDefault();
            copyCode(btn);
        }
    });

    // ============================================================
    // 10. 批量渲染公共方法
    // ============================================================
    function renderAllBenbenTexts(profile) {
        var isAdmin = profile && profile.is_admin === true;
        var username = profile && profile.username ? profile.username : '用户';

        var elements = document.querySelectorAll('.benben-text');
        elements.forEach(function (el) {
            try {
                var rawEncoded = el.getAttribute('data-raw');
                var mentionMapStr = el.getAttribute('data-mention-map');
                if (!rawEncoded) return;
                var rawText = rawEncoded;
                var mentionMap = {};
                try { mentionMap = JSON.parse(mentionMapStr || '{}'); } catch (e) {}
                // 生成唯一ID（使用元素自身的索引或随机）
                var uniqueId = 'benben-' + (el.dataset.uniqueId || Math.random().toString(36).slice(2, 8));
                el.innerHTML = renderContent(
                    rawText,
                    mentionMap,
                    isAdmin,
                    username,
                    uniqueId
                );
            } catch (e) {
                console.error('渲染犇犇内容失败:', e);
                el.innerHTML = '<p style="color:red;">内容渲染失败</p>';
            }
        });

        // 渲染 Mermaid
        renderMermaid();
    }

    // ============================================================
    // 11. 暴露公共 API
    // ============================================================
    var MarkdownRenderer = {
        renderContent: renderContent,
        renderAllBenbenTexts: renderAllBenbenTexts,
        renderMermaid: renderMermaid,
        // 暴露工具函数（可选）
        escapeHtml: escapeHtml,
        escapeHtmlAttr: escapeHtmlAttr,
        letterAvatar: letterAvatar
    };

    // 挂载到全局
    global.MarkdownRenderer = MarkdownRenderer;

})(typeof window !== 'undefined' ? window : this);