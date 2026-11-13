import {RuleTester} from 'eslint'
import tseslint from 'typescript-eslint'
import plugin from '../../tools/eslint/no-slop-comments.mjs'

var rule = (plugin.rules as Record<string, any>)['no-slop-comments']
var tester = new RuleTester({
  languageOptions: {parser: tseslint.parser, sourceType: 'module'}
})

function bad(code: string, filename?: string) {
  var c: {code: string, errors: number, filename?: string} = {code: code, errors: 1}
  if (filename) {
    c.filename = filename
  }
  return c
}

var invalidLines = [
    '// Added retry logic'
  , '// Fixed the race'
  , '// Now uses the cache'
  , '// New: cache layer'
  , '// Previously this was sync'
  , '// We now retry'
  , '// ported from the old fork'
  , '// as requested by review'
  , '// per the spec'
  , '// This function returns the id'
  , '// Here we parse the input'
  , '// We first read the file'
  , "// Let's start"
  , '// Step 1: open'
  , '// First, open the file'
  , '// Helper to parse'
  , '// Handles the request'
  , '// This is used to build keys'
  , '// Used by the router'
  , '// This ensures ordering'
  , '// IMPORTANT: do not reorder'
  , '// NOTE: this is slow'
  , '// Note that x is set'
  , '// Make sure to close it'
  , '// Simply return'
  , '// Basically a map'
  , '// Just retry'
  , '// done \u{1F680}'
  , '// no longer needed'
  , '// was changed from x'
  , '// old behaviour kept'
  , '// kept for backwards compatibility'
  , '// for historical reasons'
  , '// since v3 it differs'
  , '// 2024-05-01 fix'
  , '// November 2026 cleanup'
  , '// Temporary'
  , '// workaround for #123'
  , '/* Updated the thing */'
  , '/**\n * This class holds state\n */'
]

tester.run('stf/no-slop-comments', rule, {
  valid: [
    '// Retry on ECONNRESET; the device drops idle sockets'
  , '// Width columns keep the table aligned'
  , '// Temporary because the adb server restarts'
  , '// Workaround for adb bug where shell hangs'
  , '// slop-ok Added by hand'
  , '/* Copyright 2024 Someone\n * line\n * line\n * line\n * line\n * line */'
  , '// eslint-disable-next-line no-console'
  , '// @ts-expect-error bad types'
  , '/// <reference types="node" />'
  , '// a\n// b\n// c\n// d'
  , '// a\n// b\n\n// c\n// d\n// e\n// f'
  , 'var a = 1 // one\nvar b = 2 // two\nvar c = 3 // three\nvar d = 4 // four\nvar e = 5 // five'
  , {code: '/**\n * a\n * b\n * c\n * d\n * e\n */\nexport type A = string', filename: 'x.d.ts'}
  ]
, invalid: invalidLines.map(function(l) {
    return bad(l)
  }).concat([
    bad('// a\n// b\n// c\n// d\n// e')
  , bad('/*\n * a\n * b\n * c\n * d\n * e\n */')
  , bad('/**\n * a\n * b\n * c\n * d\n * e\n */\nexport type A = string', 'x.ts')
  ])
})
