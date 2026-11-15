import { getCurrentTools } from '@earendil-works/pi-ai';

export const SOUL_SECTION = 'pi_modular_soul';
export const GUIDE_SECTION = 'pi_modular_soul_usage';

/** Request-only: canonical history never receives SOUL bodies. */
export function projectSoul(messages, body, guidance, forced) {
  if (!messages.length || messages[0].role !== 'system') throw new Error('Pi did not provide a leading system message');
  if (forced !== undefined) {
    // Match Pi's forced-prompt semantics: the original forced text and effective
    // tools remain authoritative; only our two owned sections are added.
    return [{ role: 'system', content: forced, sections: { [SOUL_SECTION]: body, [GUIDE_SECTION]: guidance }, toolsAdded: getCurrentTools(messages), timestamp: messages[0].timestamp }, ...messages.filter(message => message.role !== 'system')];
  }
  return messages.map((message, index) => {
    if (message.role !== 'system') return message;
    const sections = { ...message.sections };
    delete sections[SOUL_SECTION]; delete sections[GUIDE_SECTION];
    if (index === 0) { sections[SOUL_SECTION] = body; sections[GUIDE_SECTION] = guidance; }
    return { ...message, sections };
  });
}
