/**
 * Validates HTML syntax by checking for balanced opening and closing tags
 * @param {string} html - The HTML string to validate
 * @returns {Object} - { valid: boolean, reason: string }
 */
function validateHtml(html) {
  if (typeof html !== 'string') {
    return { valid: false, reason: 'Input must be a string' };
  }

  if (html.trim() === '') {
    return { valid: true, reason: 'Empty string is valid' };
  }

  const stack = [];
  const selfClosingTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  // Regular expression to match HTML tags
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let match;
  let lineNumber = 1;
  let charPosition = 0;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosingTag = fullTag.startsWith('</');
    const isSelfClosing = fullTag.endsWith('/>') || selfClosingTags.has(tagName);

    // Calculate position for error reporting
    const beforeMatch = html.substring(0, match.index);
    lineNumber = beforeMatch.split('\n').length;
    charPosition = match.index - beforeMatch.lastIndexOf('\n') - 1;

    if (isSelfClosing) {
      // Self-closing tags don't need to be balanced
      continue;
    }

    if (isClosingTag) {
      // Check if we have a matching opening tag
      if (stack.length === 0) {
        return {
          valid: false,
          reason: `Unexpected closing tag </${tagName}> at line ${lineNumber}, position ${charPosition}`
        };
      }

      const lastOpenTag = stack.pop();
      if (lastOpenTag !== tagName) {
        return {
          valid: false,
          reason: `Mismatched tags: expected </${lastOpenTag}> but found </${tagName}> at line ${lineNumber}, position ${charPosition}`
        };
      }
    } else {
      // Opening tag - push onto stack
      stack.push(tagName);
    }
  }

  // Check if any opening tags weren't closed
  if (stack.length > 0) {
    const unclosedTags = stack.reverse().join(', ');
    return {
      valid: false,
      reason: `Unclosed tags: ${unclosedTags}`
    };
  }

  return { valid: true, reason: 'HTML is valid' };
}

module.exports = { validateHtml }
