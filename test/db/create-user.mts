import * as chai from 'chai'
var expect = chai.expect

import type DbApi from '../../lib/db/api.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

var inserted: any = null

function findDocument(term: any): any {
  if (Array.isArray(term)) {
    for (var item of term) {
      var found = findDocument(item)
      if (found) {
        return found
      }
    }
  }
  else if (term && typeof term === 'object') {
    if ('privilege' in term) {
      return term
    }
    for (var value of Object.values(term)) {
      var nested = findDocument(value)
      if (nested) {
        return nested
      }
    }
  }
  return null
}

mockModule(new URL('../../lib/db/index.js', import.meta.url), {default: {
  run: function(query: {build(): any}) {
    inserted = findDocument(query.build())
    return Promise.resolve({inserted: 1, changes: [{new_val: null}]})
  }
}})

var dbapi: typeof DbApi =
  (await importFresh(new URL('../../lib/db/api.js', import.meta.url))).default

describe('dbapi createUser', function() {
  var quotas = {defaultGroupsNumber: 1, defaultGroupsDuration: 1, defaultGroupsRepetitions: 1}

  beforeEach(function() {
    inserted = null
    dbapi.addGroupUser = (() => Promise.resolve('added')) as unknown as typeof dbapi.addGroupUser
    dbapi.getRootGroup = (() => Promise.resolve({
      id: 'root', owner: {email: 'admin@example.com'}, envUserGroupsNumber: 1
    , envUserGroupsDuration: 1, envUserGroupsRepetitions: 1
    })) as unknown as typeof dbapi.getRootGroup
  })

  it('should create the user as admin when an admin already exists', async function() {
    dbapi.loadUser = (() => Promise.resolve({groups: {quotas}})) as unknown as typeof dbapi.loadUser
    await dbapi.createUser('guest-1@guest.local', 'alice', '127.0.0.1')
    expect(inserted.privilege).to.equal('admin')
  })

  it('should create the first user as admin', async function() {
    dbapi.loadUser = (() => Promise.resolve(null)) as unknown as typeof dbapi.loadUser
    await dbapi.createUser('admin@example.com', 'root', '127.0.0.1')
    expect(inserted.privilege).to.equal('admin')
  })
})
