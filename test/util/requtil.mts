import * as chai from 'chai'
var expect = chai.expect

import type {Request} from 'express'
import requtil from '../../lib/util/requtil.js'

type ValidationErrors = ConstructorParameters<typeof requtil.ValidationError>[1]

describe('requtil', function() {
  describe('ValidationError', function() {
    it('should carry its message', function() {
      var errors = [] as unknown as ValidationErrors
      var err = new requtil.ValidationError('validation error', errors)

      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.equal('validation error')
      expect(err.errors).to.equal(errors)
      expect(err.stack).to.match(/^ValidationError: validation error/)
    })
  })

  describe('guestNicknameValidator', function() {
    async function run(name: unknown) {
      var req = {body: {name: name}} as unknown as Request
      for (var chain of requtil.validators.guestNicknameValidator) {
        await chain.run(req)
      }
      return {req: req, valid: await requtil.validate(req).then(() => true, () => false)}
    }

    it('should accept 1 to 64 characters and trim them', async function() {
      var result = await run('  alice ')
      expect(result.valid).to.equal(true)
      expect(result.req.body.name).to.equal('alice')
      expect((await run('x'.repeat(64))).valid).to.equal(true)
    })

    it('should reject missing, blank and too long names', async function() {
      expect((await run(undefined)).valid).to.equal(false)
      expect((await run('   ')).valid).to.equal(false)
      expect((await run('x'.repeat(65))).valid).to.equal(false)
    })
  })
})
