import assert from 'node:assert/strict';

/** SPEC 0001 §16, SPEC 0005 §6.2: prose and unrelated knowledge cannot stand
 * in for possession or the current action's observer-specific evidence. */
export function assertDailyActionAuthority({ before, after, actor, contract }) {
  const events = after.events.slice(before.events.length);
  const leaves = Object.values(before.state.campaignRuntime.itemSystem.entries)
    .filter(entry => entry.definitionRef === contract.itemDefinitionRef);
  assert.equal(leaves.length, 1, 'one authoritative source item');
  const item = leaves[0];
  const refs = [item.entryId, contract.itemDefinitionRef, contract.itemFactRef];
  const interactions = events.filter(event => event.eventType === 'WorldInteractionResolved'
    && event.payload.actorCharacterId === actor);
  let concealed;
  if (contract.acquisition === 'onConcealedSuccess') {
    const checks = interactions.filter(event => event.payload.rulingKind === 'check'
      && event.payload.check?.concealedFromRef === contract.observerRef);
    assert.equal(checks.length, 1, 'the covert action has one actual concealed check');
    concealed = checks[0];
  }
  if (!concealed || concealed.payload.check.succeeded) {
    const acquisitions = events.filter(event => event.eventType === 'InventoryOperationApplied'
      && event.payload.actorCharacterId === actor && event.payload.operation.kind === 'acquire'
      && event.payload.operation.entryRef === item.entryId && event.payload.operation.quantity === 1);
    assert.equal(acquisitions.length, 1, 'successful taking applies one real acquisition');
    const held = after.state.campaignRuntime.itemSystem.entries[acquisitions[0].payload.targetEntryId];
    assert.ok(held && held.definitionRef === item.definitionRef && held.holderRef === actor
      && held.quantity === 1 && !['consumed', 'destroyed'].includes(held.disposition), 'actor actually holds the item');
  } else {
    // SPEC 0016 §7.3: this fixture's failed taking leaves the source intact.
    // Check the item, not unrelated inventory or legitimate new knowledge.
    const source = after.state.campaignRuntime.itemSystem.entries[item.entryId];
    assert.ok(source, 'failed taking leaves the source item in place');
    for (const key of ['definitionRef', 'quantity', 'holderRef', 'sceneRef', 'disposition', 'equippedSlot']) {
      assert.deepEqual(source[key], item[key], `failed taking preserves source ${key}`);
    }
    assert.equal(events.some(event => event.eventType === 'InventoryOperationApplied'
      && event.rootActionId === concealed.rootActionId && event.payload.actorCharacterId === actor
      && event.payload.operation.entryRef === item.entryId
      && (event.payload.operation.kind === 'acquire' || (event.payload.operation.kind === 'transfer'
        && event.payload.operation.targetCharacterRef === actor))), false, 'failed taking has no acquisition');
    const heldQuantity = snapshot => Object.values(snapshot.state.campaignRuntime.itemSystem.entries)
      .filter(entry => entry.definitionRef === item.definitionRef && entry.holderRef === actor && entry.disposition === 'held')
      .reduce((sum, entry) => sum + entry.quantity, 0);
    assert.equal(heldQuantity(after), heldQuantity(before), 'failed taking creates no held copy');
  }
  if (concealed?.payload.check.succeeded) return;
  const frozen = concealed && events.find(event => event.eventType === 'RandomnessRequested'
    && event.payload.request?.resolutionId === concealed.resolutionId)?.payload.request.frozenCheck.concealment;
  if (concealed) assert.ok(frozen, 'noticed evidence comes from the frozen check');
  const evidence = events.filter(event => {
    if (event.eventType !== 'SensoryEvidenceAcquired' || event.payload.characterId !== contract.observerRef) return false;
    const fact = after.state.canonicalFacts[event.payload.factId];
    if (fact?.kind !== 'worldInteractionSensoryEvidence' || fact.value.observerRef !== contract.observerRef) return false;
    if (concealed) {
      const source = frozen.evidencePolicy?.primaryFailureSource;
      if (event.resolutionId !== (source?.resolutionId ?? concealed.resolutionId)
        || event.rootActionId !== concealed.rootActionId || fact.value.subjectRef !== actor
        || fact.value.sense !== frozen.sense || fact.value.evidence !== frozen.evidence) return false;
      if (source == null) return true;
      const resolved = interactions.find(candidate => candidate.rootActionId === concealed.rootActionId
        && candidate.resolutionId === source.resolutionId && candidate.payload.branch === source.branch);
      const record = resolved?.payload.sensoryEvidence[source.evidenceIndex];
      return record?.observerRef === contract.observerRef && record.subjectRef === actor
        && record.sense === frozen.sense && record.evidence === frozen.evidence;
    }
    if (event.payload.sense !== contract.sense) return false;
    return interactions.some(resolved => resolved.rootActionId === event.rootActionId && resolved.resolutionId === event.resolutionId
      && resolved.payload.sensoryEvidence.some(record => record.observerRef === contract.observerRef
        && [actor, item.entryId].includes(record.subjectRef) && record.sense === event.payload.sense
        && record.evidence === event.payload.publicEvidence && record.basisRefs.some(ref => refs.includes(ref))));
  });
  assert.ok(evidence.length > 0, 'observer acquired evidence of this action, not merely a conversation');
  for (const event of evidence) {
    const { factId, publicEvidence, sense } = event.payload;
    const fact = after.state.canonicalFacts[factId], held = after.state.knowledge[contract.observerRef]?.[factId];
    assert.equal(before.state.knowledge[contract.observerRef]?.[factId], undefined, 'new evidence');
    assert.equal(held?.objectKind, 'sensoryEvidence');
    assert.equal(held.acquiredByEventId, event.eventId);
    assert.equal(held.content, publicEvidence);
    assert.ok(held.provenanceChain.includes(factId) && held.provenanceChain.includes(event.eventId));
    assert.equal(fact.value.sense, sense);
    assert.equal(fact.value.evidence, publicEvidence);
  }
}
