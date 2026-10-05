// HOMESTEAD Creature names: the one validator, used by the page (before it
// sends a rename) and by the server (which decides). Improve the rules here.
//
// Loaded as window.HOMESTEAD_CREATURE_NAME in the page, and with
// require('./public/js/creature-name') on the server.
(function (root) {
  var cfg = typeof module === 'object' && module.exports
    ? require('./creature-config')
    : root.HOMESTEAD_CREATURE_CONFIG;
  var RULES = cfg.NAME_RULES;

  // Letters and numbers from any language (with their accents), in words
  // separated by single spaces. Anything else, control characters included,
  // is refused.
  var ALLOWED = /^[\p{L}\p{M}\p{N}]+(?: [\p{L}\p{M}\p{N}]+)*$/u;

  // Returns { ok: true, name } with the cleaned name, or { ok: false, error }.
  function validate(raw) {
    if (typeof raw !== 'string') return { ok: false, error: 'Type a name.' };
    // Trim, and fold any run of spaces inside into one.
    var name = raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
    if (!name) return { ok: false, error: 'Type a name.' };
    var length = Array.from(name).length;
    if (length < RULES.min) return { ok: false, error: 'Names need at least ' + RULES.min + ' characters.' };
    if (length > RULES.max) return { ok: false, error: 'Names can be at most ' + RULES.max + ' characters.' };
    if (!ALLOWED.test(name)) return { ok: false, error: 'Use only letters, numbers and spaces.' };
    return { ok: true, name: name };
  }

  var api = Object.freeze({ validate: validate, RULES: RULES });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HOMESTEAD_CREATURE_NAME = api;
})(typeof window !== 'undefined' ? window : this);
