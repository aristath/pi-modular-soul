import { getCurrentSystemMessage, getCurrentTools } from '@earendil-works/pi-ai';

export const SOUL_SECTION = 'pi_modular_soul';
export const GUIDE_SECTION = 'pi_modular_soul_usage';

/** Request-only: canonical history never receives SOUL bodies. */
export function projectSoul(messages, body, guidance, forced) {
  if (forced !== undefined) {
    // Match Pi's forced-prompt semantics: the original forced text and effective
    // tools remain authoritative; only our two owned sections are added.
    const timestamp = messages[0]?.role === 'system' ? messages[0].timestamp : getCurrentSystemMessage(messages)?.timestamp ?? Date.now();
    return [{ role: 'system', content: forced, sections: { [SOUL_SECTION]: body, [GUIDE_SECTION]: guidance }, toolsAdded: getCurrentTools(messages), timestamp }, ...messages.filter(message => message.role !== 'system')];
  }
  if (messages[0]?.role !== 'system') {
    // Pi does not guarantee a leading system message in context_with_system.
    // Fold any system messages into a new head that carries our sections (or
    // prepend a minimal one); throwing here would drop the SOUL from the request.
    const head = getCurrentSystemMessage(messages);
    const sections = { ...head?.sections };
    delete sections[SOUL_SECTION]; delete sections[GUIDE_SECTION];
    sections[SOUL_SECTION] = body; sections[GUIDE_SECTION] = guidance;
    const lead = { role: 'system', content: head?.content ?? '', sections, ...(head?.toolsAdded?.length ? { toolsAdded: head.toolsAdded } : {}), timestamp: head?.timestamp ?? Date.now() };
    return [lead, ...messages.filter(message => message.role !== 'system')];
  }
  return messages.map((message, index) => {
    if (message.role !== 'system') return message;
    const sections = { ...message.sections };
    delete sections[SOUL_SECTION]; delete sections[GUIDE_SECTION];
    if (index === 0) { sections[SOUL_SECTION] = body; sections[GUIDE_SECTION] = guidance; }
    return { ...message, sections };
  });
}
