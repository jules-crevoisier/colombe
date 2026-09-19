import type { DeviceSettings } from '#shared/types/config'
import { getConfig } from '../../lib/config'
import { deviceSettings } from '../../lib/devices/settings'
import { mailError, requireMail } from '../../utils/mail-session'

/** Paramètres à saisir dans un autre logiciel (Gmail, iPhone, Outlook, Thunderbird). Jamais de mot de passe. */
export default defineEventHandler(async (event): Promise<DeviceSettings> => {
  try {
    const { email } = await requireMail(event)
    return deviceSettings(email, getConfig())
  }
  catch (err) {
    throw mailError(err, event)
  }
})
