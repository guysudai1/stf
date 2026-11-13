import fs from 'node:fs'
import {purgeUsers, recordedUsers} from '../harness.mjs'

export default async function() {
  await purgeUsers(recordedUsers())
  fs.rmSync(process.env.PARITY_USERS_FILE, {force: true})
}
