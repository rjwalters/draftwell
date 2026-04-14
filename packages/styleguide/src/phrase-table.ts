/**
 * Inflated phrase -> plain replacement lookup table.
 *
 * Drawn from Orwell's "verbal false limbs" concept: writers pad out
 * simple verbs with noun-and-verb constructions that sound important
 * but say less. Each entry maps an inflated phrase to its plain
 * equivalent.
 */
export const inflatedPhrases: ReadonlyMap<string, string> = new Map([
  // Verbal false limbs (Orwell)
  ["make contact with", "call"],
  ["exhibit a tendency to", "tend to"],
  ["serve the purpose of", "be"],
  ["play a leading part in", "lead"],
  ["give rise to", "cause"],
  ["have the effect of", "make"],
  ["take into consideration", "consider"],
  ["take into account", "consider"],
  ["give an account of", "describe"],
  ["make provision for", "provide for"],
  ["render inoperative", "break"],
  ["militate against", "prevent"],
  ["prove unacceptable", "reject"],
  ["make itself felt", "affect"],
  ["in the event that", "if"],
  ["owing to the fact that", "because"],
  ["due to the fact that", "because"],
  ["in spite of the fact that", "although"],
  ["by virtue of the fact that", "because"],
  ["with regard to", "about"],
  ["with respect to", "about"],
  ["in reference to", "about"],
  ["in relation to", "about"],
  ["in connection with", "about"],
  ["on the subject of", "about"],
  ["for the purpose of", "to"],
  ["in order to", "to"],
  ["with a view to", "to"],
  ["on the grounds that", "because"],
  ["on the basis of", "by"],
  ["in the course of", "during"],
  ["at this point in time", "now"],
  ["at the present time", "now"],
  ["at the current time", "now"],
  ["prior to", "before"],
  ["subsequent to", "after"],
  ["in the near future", "soon"],
  ["a large number of", "many"],
  ["a sufficient number of", "enough"],
  ["the vast majority of", "most"],
  ["a considerable amount of", "much"],
  ["in the absence of", "without"],
  ["is in a position to", "can"],
  ["has the capacity to", "can"],
  ["has the ability to", "can"],
  ["it is necessary that", "must"],
  ["it is important that", "should"],

  // Jargon and pretentious diction (Orwell)
  ["utilize", "use"],
  ["leverage", "use"],
  ["facilitate", "help"],
  ["endeavor", "try"],
  ["commence", "start"],
  ["terminate", "end"],
  ["ascertain", "find out"],
  ["ameliorate", "improve"],
  ["effectuate", "carry out"],
  ["promulgate", "announce"],
  ["implement a solution", "fix"],
  ["interface with", "talk to"],
  ["impact negatively", "hurt"],
  ["impact positively", "help"],
  ["optimize", "improve"],
  ["finalize", "finish"],
  ["conceptualize", "think of"],
  ["incentivize", "encourage"],
  ["operationalize", "put into practice"],
  ["paradigm shift", "change"],
  ["synergy", "cooperation"],
  ["bandwidth", "time"],
  ["low-hanging fruit", "easy win"],
  ["move the needle", "make progress"],
  ["circle back", "revisit"],
  ["deep dive", "close look"],
]);

/**
 * Build a case-insensitive regex that matches any inflated phrase.
 * Word boundaries ensure we don't match partial words.
 */
export function buildPhrasePattern(): RegExp {
  const escaped = [...inflatedPhrases.keys()].map((phrase) =>
    phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  // Sort longest-first so longer phrases match before shorter substrings.
  escaped.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}
