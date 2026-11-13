import fs from 'node:fs'
import path from 'node:path'

var MAX_LINES = 4

// Pre-existing upstream hits, keyed by file then "[name] first-line". Port code is never listed.
var baseline = JSON.parse(fs.readFileSync(new URL('./slop-baseline.json', import.meta.url), 'utf8'))

var startPatterns = [
    ['change-log', /^(added|adds|updated|updates|changed|fixed|fixes|refactored|removed|now|moved|ported|previously|originally)\b/i
    , 'Comment describes the change, not the code. Delete it or state the invariant.']
  , ['change-log', /^new:/i, 'Comment describes the change, not the code.']
  , ['change-log', /^(we|this) now\b/i, 'Comment describes the change, not the code.']
  , ['narration', /^this (function|method|component|hook|file|class|helper|module)\b/i
    , 'Comment narrates the code. The name and types should say it.']
  , ['narration', /^here we\b/i, 'Comment narrates the code.']
  , ['narration', /^we (first|then|now)\b/i, 'Comment narrates the code.']
  , ['narration', /^let's\b/i, 'Comment narrates the code.']
  , ['narration', /^step \d/i, 'Step-numbered comments narrate the code.']
  , ['narration', /^(first|then|finally),/i, 'Sequencing comments narrate the code.']
  , ['narration', /^helper (function|to)\b/i, 'Comment narrates the code.']
  , ['narration', /^handles the\b/i, 'Comment narrates the code.']
  , ['narration', /^this is used (to|for|by|when)\b/i, 'Use-case comment. Say why, not what for.']
  , ['narration', /^used (to|for|by)\b/i, 'Use-case comment. Say why, not what for.']
  , ['narration', /^this ensures\b/i, 'Comment narrates the code.']
  , ['filler', /^important:/i, 'Emphasis filler. State the constraint plainly.']
  , ['filler', /^note:/i, 'Emphasis filler. State the constraint plainly.']
  , ['filler', /^note that\b/i, 'Filler. State the constraint plainly.']
  , ['filler', /^make sure to\b/i, 'Filler. State the constraint plainly.']
  , ['filler', /^(simply|basically)\b/i, 'Filler word.']
  , ['filler', /^just /i, 'Filler word.']
]

var anywherePatterns = [
    ['change-log', /\b(ported from|old fork|the fork|original code|as requested|per the spec|per the checklist)\b/i
    , 'Comment refers to the porting or review process, not the code.']
  , ['archaeological', /\b(previously|formerly|no longer|used to (be|have|return|work|do|call|take)|was (changed|removed|added|replaced)|has been (changed|replaced|removed|added)|changed from|instead of the old|old behaviou?r|kept for backwards? compat\w*|for historical reasons|(as of|since|in) v\d+|(19|20)\d\d-\d\d-\d\d|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (19|20)\d\d)\b/i
    , 'Comment describes history, not the code as it is. Delete it; git has the history.']
  , ['archaeological', /\bworkaround for\b.*(#\d+|\bPR\b|\bcommit\b|\b[0-9a-f]{7,40}\b)/i
    , 'Reference the cause, not a commit or PR; history lives in git.']
  , ['archaeological', /^temporar(y|ily)\b(?!.*\b(because|until|due|while|so|since|when|as)\b)/i
    , 'Temporary without a reason. Say why and until when, or remove.']
  , ['filler', /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]/u, 'No emojis in comments.']
]

var exemptRe = /slop-ok|^\s*(eslint-|@ts-|\/\s*<reference|global |globals |istanbul |c8 |v8 |prettier-|jshint|jscs)|\b(license|copyright|spdx-license-identifier)\b/i

function lineTexts(comment) {
  var lines = comment.value.split('\n')

  if (comment.type === 'Block') {
    return lines.map(function(line) {
      return line.replace(/^\s*\*+(?!\/)\s?/, '').trim()
    })
  }

  return lines.map(function(line) {
    return line.trim()
  })
}

var rule = {
  meta: {
    type: 'suggestion'
  , schema: []
  , messages: {
      slop: '[{{name}}] {{message}} ("{{text}}")'
    , tooLong: '[too-long] Comment is {{count}} lines (max {{max}}). Trim it to the non-obvious why. ("{{text}}")'
    }
  }
, create: function(context) {
    var sourceCode = context.sourceCode
    var isDts = /\.d\.[cm]?ts$/.test(context.filename)

    function report(loc, id, data) {
      var rel = path.relative(context.cwd, context.filename).split(path.sep).join('/')
      var name = id === 'tooLong' ? 'too-long' : data.name
      var entries = baseline[rel]
      if (entries && entries.indexOf('[' + name + '] ' + data.text) !== -1) {
        return
      }
      context.report({loc: loc, messageId: id, data: data})
    }

    function checkText(comment, text, loc) {
      var i, p
      if (!text) {
        return
      }
      for (i = 0; i < startPatterns.length; i++) {
        p = startPatterns[i]
        if (p[1].test(text)) {
          report(loc, 'slop', {name: p[0], message: p[2], text: text.slice(0, 60)})
          return
        }
      }
      for (i = 0; i < anywherePatterns.length; i++) {
        p = anywherePatterns[i]
        if (p[1].test(text)) {
          report(loc, 'slop', {name: p[0], message: p[2], text: text.slice(0, 60)})
          return
        }
      }
    }

    function checkComment(comment) {
      var texts = lineTexts(comment)
      var offset = 0
      var line

      if (exemptRe.test(comment.value)) {
        return
      }

      if (comment.type === 'Block' && isDts && comment.value.startsWith('*')) {
        return
      }

      texts.forEach(function(text, idx) {
        line = comment.loc.start.line + idx
        checkText(comment, text, {
          start: {line: line, column: idx === 0 ? comment.loc.start.column : 0}
        , end: {line: line, column: idx === 0 ? comment.loc.start.column + 2 + text.length : 1}
        })
        offset += 1
      })

      if (comment.type === 'Block') {
        var content = texts.slice()
        while (content.length && content[0] === '') {
          content.shift()
        }
        while (content.length && content[content.length - 1] === '') {
          content.pop()
        }
        if (content.length > MAX_LINES) {
          report(comment.loc, 'tooLong', {count: content.length, max: MAX_LINES
            , text: content[0].slice(0, 60)})
        }
      }
    }

    return {
      Program: function() {
        var comments = sourceCode.getAllComments().filter(function(c) {
          return c.type !== 'Shebang'
        })
        var run = []

        function flush() {
          if (run.length > MAX_LINES && !run.some(function(c) {
            return exemptRe.test(c.value)
          })) {
            report({start: run[0].loc.start, end: run[run.length - 1].loc.end}
              , 'tooLong', {count: run.length, max: MAX_LINES
                , text: run[0].value.trim().slice(0, 60)})
          }
          run = []
        }

        comments.forEach(function(c) {
          checkComment(c)
          if (c.type === 'Line') {
            var prev = run[run.length - 1]
            var standalone = sourceCode.lines[c.loc.start.line - 1]
              .slice(0, c.loc.start.column).trim() === ''
            if (prev && (!standalone || prev.loc.end.line + 1 !== c.loc.start.line)) {
              flush()
            }
            if (standalone) {
              run.push(c)
            }
          }
          else {
            flush()
          }
        })
        flush()
      }
    }
  }
}

export default {meta: {name: 'stf'}, rules: {'no-slop-comments': rule}}
