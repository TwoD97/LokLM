// auth domain strings. Keys are 'auth.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const authDict: DomainDict = {
  en: {
    // Brand fallbacks
    'auth.fallbackName': 'LokLM',

    // LoginView
    'auth.stageDeriving': 'Deriving key …',
    'auth.stageDecrypting': 'Decrypting vault …',
    'auth.stageRestoring': 'Loading library …',
    'auth.stageReady': 'Ready.',
    'auth.unlocking': 'Unlocking …',
    'auth.unlock': 'Unlock →',
    'auth.loginLead': 'Enter your password to unlock the vault.',
    'auth.passwordLabel': 'Password',
    'auth.badCredentials': 'Account or password incorrect.',
    'auth.tooManyAttempts': 'Too many failed attempts. Please wait {time} longer.',
    'auth.forgotPassword': 'Forgot password?',

    // RegisterView
    'auth.createAccount': 'Create account',
    'auth.registering': 'Registering …',
    'auth.registerLead':
      'One-time account on this device. Your data stays local and is stored encrypted.',
    'auth.sectionIdentity': '01 · Identity',
    'auth.sectionSecurity': '02 · Security',
    'auth.displayName': 'Display name',
    'auth.displayNameHint': '3–32 characters.',
    'auth.recoveryLangLegend': 'Language of the recovery words',
    'auth.langGerman': 'German',
    'auth.langEnglish': 'English',
    'auth.password': 'Password',
    'auth.passwordHint':
      'At least 10 characters, three of the four classes (uppercase, lowercase, digit, special character). Currently: {chars} characters, {classes} classes.',
    'auth.repeatPassword': 'Repeat password',
    'auth.repeatHintEmpty': 'For safety, once more.',
    'auth.repeatHintMatch': 'Matches.',
    'auth.repeatHintMismatch': "Doesn't match.",
    'auth.alreadyRegistered': 'Already registered? Sign in.',

    // ResetView
    'auth.resetTitle': 'Reset password',
    'auth.resetLead':
      'Enter your {count} recovery words ({lang}) and a new password. After a successful reset you get new words — the old ones expire.',
    'auth.recoveryWords': 'Recovery words',
    'auth.recoveryWordsPlaceholder': '18 words separated by spaces',
    'auth.wordsCount': '{count} / {total} words',
    'auth.wordsAllRecognized': 'All {total} words recognized.',
    'auth.wordsWrongLength': 'Expected {total} words, found {count}.',
    'auth.wordsUnknown': 'Word {index} is unknown: "{word}".',
    'auth.newPassword': 'New password',
    'auth.newPasswordPlaceholder': 'New password',
    'auth.newPasswordRepeat': 'Repeat new password',
    'auth.newPasswordHint': 'At least 10 characters, three of the four classes.',
    'auth.resetMismatchPlaceholder': '—',
    'auth.resetting': 'Resetting …',
    'auth.resetSubmit': 'Reset',
    'auth.resetBadCode': 'Recovery words or account unknown.',

    // PassphraseReveal
    'auth.revealTitle': 'Recovery words',
    'auth.revealBadge': '{count} words',
    'auth.revealLead':
      'These {count} words are your only way back if you forget your password. Write them down now — they are not stored anywhere and cannot be shown again.',
    'auth.copyToClipboard': 'Copy to clipboard',
    'auth.copiedToClipboard': 'Copied to clipboard',
    'auth.revealConfirm': 'I have safely written down the 18 words.',

    // PasswordRetypeGate
    'auth.retypeConfirmDefault': 'Confirm',
    'auth.retypeChecking': 'Checking …',
    'auth.retypeBadPassword': 'Wrong password.',
    'auth.retypeRateLimited': 'Too many failed attempts. Try again in {secs}s.',
    'auth.retypeLockedSession': 'Session is locked.',
    'auth.retypeNoVault': 'No vault registered.',

    // UnlockedView
    'auth.lobbyFallbackName': 'Signed in',
    'auth.lobbyVaultUnlocked': 'Vault unlocked',
    'auth.lobbyLead':
      'App features arrive in upcoming work packages. Until then you can lock the vault or sign out.',
    'auth.lock': 'Lock',
    'auth.logout': 'Sign out',
  },
  de: {
    // Brand fallbacks
    'auth.fallbackName': 'LokLM',

    // LoginView
    'auth.stageDeriving': 'Schlüssel ableiten …',
    'auth.stageDecrypting': 'Tresor entschlüsseln …',
    'auth.stageRestoring': 'Bibliothek laden …',
    'auth.stageReady': 'Bereit.',
    'auth.unlocking': 'Entsperre …',
    'auth.unlock': 'Entsperren →',
    'auth.loginLead': 'Passwort eingeben, um den Tresor zu entsperren.',
    'auth.passwordLabel': 'Passwort',
    'auth.badCredentials': 'Konto oder Passwort falsch.',
    'auth.tooManyAttempts': 'Zu viele Fehlversuche. Bitte noch {time} warten.',
    'auth.forgotPassword': 'Passwort vergessen?',

    // RegisterView
    'auth.createAccount': 'Konto anlegen',
    'auth.registering': 'Registriere …',
    'auth.registerLead':
      'Einmaliges Konto auf diesem Gerät. Die Daten bleiben lokal und werden verschlüsselt abgelegt.',
    'auth.sectionIdentity': '01 · Identität',
    'auth.sectionSecurity': '02 · Sicherheit',
    'auth.displayName': 'Anzeigename',
    'auth.displayNameHint': '3–32 Zeichen.',
    'auth.recoveryLangLegend': 'Sprache der Wiederherstellungs-Wörter',
    'auth.langGerman': 'Deutsch',
    'auth.langEnglish': 'English',
    'auth.password': 'Passwort',
    'auth.passwordHint':
      'Mindestens 10 Zeichen, drei der vier Klassen (Groß-, Kleinbuchstabe, Ziffer, Sonderzeichen). Aktuell: {chars} Zeichen, {classes} Klassen.',
    'auth.repeatPassword': 'Passwort wiederholen',
    'auth.repeatHintEmpty': 'Zur Sicherheit nochmal.',
    'auth.repeatHintMatch': 'Passt.',
    'auth.repeatHintMismatch': 'Stimmt nicht überein.',
    'auth.alreadyRegistered': 'Schon registriert? Anmelden.',

    // ResetView
    'auth.resetTitle': 'Passwort zurücksetzen',
    'auth.resetLead':
      'Gib die {count} Wiederherstellungs-Wörter ({lang}) und ein neues Passwort ein. Nach erfolgreichem Reset bekommst du neue Wörter — die alten verfallen.',
    'auth.recoveryWords': 'Wiederherstellungs-Wörter',
    'auth.recoveryWordsPlaceholder': '18 Wörter durch Leerzeichen getrennt',
    'auth.wordsCount': '{count} / {total} Wörter',
    'auth.wordsAllRecognized': 'Alle {total} Wörter erkannt.',
    'auth.wordsWrongLength': 'Erwarte {total} Wörter, gefunden {count}.',
    'auth.wordsUnknown': 'Wort {index} ist unbekannt: "{word}".',
    'auth.newPassword': 'Neues Passwort',
    'auth.newPasswordPlaceholder': 'Neues Passwort',
    'auth.newPasswordRepeat': 'Neues Passwort wiederholen',
    'auth.newPasswordHint': 'Mindestens 10 Zeichen, drei der vier Klassen.',
    'auth.resetMismatchPlaceholder': '—',
    'auth.resetting': 'Setze zurück …',
    'auth.resetSubmit': 'Zurücksetzen',
    'auth.resetBadCode': 'Wiederherstellungs-Wörter oder Konto unbekannt.',

    // PassphraseReveal
    'auth.revealTitle': 'Wiederherstellungs-Wörter',
    'auth.revealBadge': '{count} Wörter',
    'auth.revealLead':
      'Diese {count} Wörter sind dein einziger Weg zurück, falls du das Passwort vergisst. Notiere sie jetzt — sie werden nirgendwo gespeichert und können nicht erneut angezeigt werden.',
    'auth.copyToClipboard': 'In Zwischenablage kopieren',
    'auth.copiedToClipboard': 'In Zwischenablage',
    'auth.revealConfirm': 'Ich habe die 18 Wörter sicher notiert.',

    // PasswordRetypeGate
    'auth.retypeConfirmDefault': 'Bestätigen',
    'auth.retypeChecking': 'Prüfe …',
    'auth.retypeBadPassword': 'Falsches Passwort.',
    'auth.retypeRateLimited': 'Zu viele Fehlversuche. In {secs}s erneut versuchen.',
    'auth.retypeLockedSession': 'Sitzung ist gesperrt.',
    'auth.retypeNoVault': 'Kein Tresor registriert.',

    // UnlockedView
    'auth.lobbyFallbackName': 'Eingeloggt',
    'auth.lobbyVaultUnlocked': 'Tresor entsperrt',
    'auth.lobbyLead':
      'Die App-Funktionen kommen mit den nächsten APs. Bis dahin kannst du den Tresor sperren oder dich abmelden.',
    'auth.lock': 'Sperren',
    'auth.logout': 'Abmelden',
  },
}
