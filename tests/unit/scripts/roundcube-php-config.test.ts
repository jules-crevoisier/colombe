import { describe, expect, it } from 'vitest'
import {
  hasVerifyPeerFalse,
  parseHostUri,
  parsePhpLiteral,
  parseRoundcubeMainConfig,
  parseRoundcubeManagesieveConfig,
  stripPhpComments,
} from '../../../scripts/lib/roundcube.mjs'

describe('stripPhpComments', () => {
  it('removes // and # line comments without touching scheme URIs', () => {
    const source = `<?php\n// commentaire\n$config['imap_host'] = 'ssl://mail.example.org:993'; # fin de ligne\n`
    const clean = stripPhpComments(source)
    expect(clean).toContain(`'ssl://mail.example.org:993'`)
    expect(clean).not.toContain('commentaire')
    expect(clean).not.toContain('fin de ligne')
  })

  it('removes /* */ blocks', () => {
    const source = `$config['a'] = 1; /* bloc\nsur plusieurs\nlignes */ $config['b'] = 2;`
    const clean = stripPhpComments(source)
    expect(clean).not.toContain('bloc')
    expect(clean).toContain(`$config['b'] = 2;`)
  })

  it('does not strip # or // inside strings', () => {
    const source = `$config['x'] = 'a#b//c';`
    expect(stripPhpComments(source)).toContain(`'a#b//c'`)
  })
})

describe('parsePhpLiteral', () => {
  it('parses single and double quoted strings with escapes', () => {
    expect(parsePhpLiteral(`'it\\'s ok'`)).toBe(`it's ok`)
    expect(parsePhpLiteral(`"line1\\nline2"`)).toBe('line1\nline2')
  })

  it('parses booleans, null and numbers', () => {
    expect(parsePhpLiteral('true')).toBe(true)
    expect(parsePhpLiteral('false')).toBe(false)
    expect(parsePhpLiteral('null')).toBe(null)
    expect(parsePhpLiteral('993')).toBe(993)
  })

  it('parses indexed arrays (array() and [])', () => {
    expect(parsePhpLiteral(`array('a', 'b', 'c')`)).toEqual(['a', 'b', 'c'])
    expect(parsePhpLiteral(`['a', 'b']`)).toEqual(['a', 'b'])
  })

  it('parses nested associative arrays', () => {
    const result = parsePhpLiteral(`array('ssl' => array('verify_peer' => false, 'verify_peer_name' => false))`)
    expect(result).toEqual({ ssl: { verify_peer: false, verify_peer_name: false } })
  })
})

describe('parseHostUri', () => {
  it('extracts scheme, host, port from ssl:// and tls:// URIs', () => {
    expect(parseHostUri('ssl://mail.example.org:993')).toEqual({ scheme: 'ssl', host: 'mail.example.org', port: 993 })
    expect(parseHostUri('tls://mail.example.org:587')).toEqual({ scheme: 'tls', host: 'mail.example.org', port: 587 })
  })

  it('handles a bare host:port with no scheme', () => {
    expect(parseHostUri('localhost:25')).toEqual({ scheme: null, host: 'localhost', port: 25 })
  })

  it('handles a bare hostname with no port', () => {
    expect(parseHostUri('mail.example.org')).toEqual({ scheme: null, host: 'mail.example.org', port: null })
  })
})

describe('hasVerifyPeerFalse', () => {
  it('detects verify_peer=false nested in a conn_options structure', () => {
    const options = { ssl: { verify_peer: false, verify_peer_name: false } }
    expect(hasVerifyPeerFalse(options)).toBe(true)
  })

  it('is false when verify_peer is true or absent', () => {
    expect(hasVerifyPeerFalse({ ssl: { verify_peer: true } })).toBe(false)
    expect(hasVerifyPeerFalse({ ssl: {} })).toBe(false)
    expect(hasVerifyPeerFalse(undefined)).toBe(false)
  })
})

describe('parseRoundcubeMainConfig — style Roundcube 1.6', () => {
  const source = `<?php
$config['imap_host'] = 'ssl://mail.example.org:993';
$config['smtp_host'] = 'tls://mail.example.org:587';
$config['username_domain'] = 'example.org';
$config['product_name'] = 'Webmail Example';
$config['support_url'] = 'https://example.org/support';
`

  it('extracts imap/smtp host+port+scheme', () => {
    const result = parseRoundcubeMainConfig(source)
    expect(result.imap).toMatchObject({ scheme: 'ssl', host: 'mail.example.org', port: 993, source: 'imap_host' })
    expect(result.smtp).toMatchObject({ scheme: 'tls', host: 'mail.example.org', port: 587, source: 'smtp_host' })
  })

  it('extracts username_domain, product_name and support_url', () => {
    const result = parseRoundcubeMainConfig(source)
    expect(result.usernameDomain).toBe('example.org')
    expect(result.productName).toBe('Webmail Example')
    expect(result.supportUrl).toBe('https://example.org/support')
    expect(result.warnings).toEqual([])
  })
})

describe('parseRoundcubeMainConfig — style ancien (default_host/default_port, smtp_server/smtp_port)', () => {
  const source = `<?php
$config['default_host'] = 'mail.example.org';
$config['default_port'] = 143;
$config['smtp_server'] = 'mail.example.org';
$config['smtp_port'] = 25;
`

  it('falls back to legacy keys and reports the legacy source', () => {
    const result = parseRoundcubeMainConfig(source)
    expect(result.imap).toMatchObject({ host: 'mail.example.org', port: 143 })
    expect(result.imap!.source).toMatch(/ancien style/)
    expect(result.smtp).toMatchObject({ host: 'mail.example.org', port: 25 })
    expect(result.smtp!.source).toMatch(/ancien style/)
  })
})

describe('parseRoundcubeMainConfig — imap_host tableau (multi-hôtes)', () => {
  const source = `$config['imap_host'] = array('ssl://imap1.example.org:993', 'ssl://imap2.example.org:993');`

  it('takes the first entry and warns', () => {
    const result = parseRoundcubeMainConfig(source)
    expect(result.imap).toMatchObject({ host: 'imap1.example.org', port: 993 })
    expect(result.warnings.some(w => /tableau/.test(w))).toBe(true)
  })
})

describe('parseRoundcubeMainConfig — espace réservé Roundcube (%d, %n, %t, %s)', () => {
  it('flags a placeholder in imap_host', () => {
    const result = parseRoundcubeMainConfig(`$config['imap_host'] = 'ssl://%d:993';`)
    expect(result.imap!.hasPlaceholder).toBe(true)
    expect(result.warnings.some(w => /espace réservé/.test(w))).toBe(true)
  })

  it('does not flag a normal hostname', () => {
    const result = parseRoundcubeMainConfig(`$config['imap_host'] = 'ssl://mail.example.org:993';`)
    expect(result.imap!.hasPlaceholder).toBe(false)
  })
})

describe('parseRoundcubeMainConfig — verify_peer désactivé', () => {
  it('warns loudly for imap_conn_options and smtp_conn_options', () => {
    const source = `
$config['imap_conn_options'] = array('ssl' => array('verify_peer' => false, 'verify_peer_name' => false));
$config['smtp_conn_options'] = array('ssl' => array('verify_peer' => false));
`
    const result = parseRoundcubeMainConfig(source)
    expect(result.warnings.some(w => /imap_conn_options/.test(w) && /production/.test(w))).toBe(true)
    expect(result.warnings.some(w => /smtp_conn_options/.test(w))).toBe(true)
  })
})

describe('parseRoundcubeMainConfig — dernière affectation gagne (comme PHP)', () => {
  it('uses the last uncommented assignment when a key is set twice', () => {
    const source = `
$config['imap_host'] = 'ssl://old.example.org:993';
// $config['imap_host'] = 'ssl://commented-out.example.org:993';
$config['imap_host'] = 'ssl://new.example.org:993';
`
    const result = parseRoundcubeMainConfig(source)
    expect(result.imap!.host).toBe('new.example.org')
  })
})

describe('parseRoundcubeManagesieveConfig', () => {
  it('extracts managesieve_host and managesieve_port', () => {
    const result = parseRoundcubeManagesieveConfig(`$config['managesieve_host'] = 'tls://mail.example.org:4190';`)
    expect(result).toMatchObject({ scheme: 'tls', host: 'mail.example.org', port: 4190 })
  })

  it('falls back to managesieve_port when the host has none', () => {
    const result = parseRoundcubeManagesieveConfig(`
$config['managesieve_host'] = 'mail.example.org';
$config['managesieve_port'] = 4190;
`)
    expect(result).toMatchObject({ host: 'mail.example.org', port: 4190 })
  })
})
