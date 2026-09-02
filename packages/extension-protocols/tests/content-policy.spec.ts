import { describe, expect, it } from 'vitest'
import { containsCredentialMaterial } from '../src/content-policy.ts'

describe('credential material policy', () => {
  it.each([
    '-----BEGIN PRIVATE KEY-----',
    'api_key = abcdefghijklmnop',
    'access-token: abcdefghijklmnop',
    'client_secret=abcdefghijklmnop',
    'sk_live_1234567890abcdefgh',
    'ghp_12345678901234567890',
    'eyJabcdefgh.ijklmnop.qrstuvwx',
  ])('detects credential-shaped content: %s', content => {
    expect(containsCredentialMaterial(content)).toBe(true)
  })

  it.each([
    'The API key should be read from the environment.',
    'Never store access tokens in proposal rationale.',
    'A password manager is preferred.',
    'The prompt discusses client secret rotation without including a value.',
    'sketch_live_1234567890abcdefgh',
  ])('does not reject ordinary prose: %s', content => {
    expect(containsCredentialMaterial(content)).toBe(false)
  })
})
