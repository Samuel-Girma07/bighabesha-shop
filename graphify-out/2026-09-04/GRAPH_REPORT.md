# Graph Report - Bot  (2026-09-04)

## Corpus Check
- 303 files · ~843,514 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4323 nodes · 11502 edges · 163 communities (144 shown, 19 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 212 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9fd16319`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- live-browser.js
- checks.mjs
- context.mjs
- orders.service.ts
- design-system.mjs
- resumeSession
- bot.ts
- detect-antipatterns-browser.js
- injected/index.mjs
- server.ts
- live-server.mjs
- hook-lib.mjs
- Icons.tsx
- svelte-component.mjs
- concept-seed.mjs
- setLiveState
- modern-screenshot.umd.js
- el
- css-cascade.mjs
- detect-text.mjs
- parseAnyColor
- api/admin.ts
- manual-apply.mjs
- getDatabase
- api.ts
- detect-antipatterns.mjs
- live-commit-manual-edits.mjs
- initPageChat
- Skill Command Routing Architecture
- detect-url.mjs
- hook-before-edit.mjs
- impeccable-config.mjs
- Executable Work Order & Concurrency Audit
- start.ts
- devDependencies
- reseller_cascade.test.ts
- hook-admin.mjs
- initGlobalBar
- live-copy-edit-agent.mjs
- live-wrap.mjs
- live-accept.mjs
- live-poll.mjs
- maintenance.test.ts
- scanCssTextForPulsingDot
- parseAnyColor
- design-parser.mjs
- doctor.mjs
- applyEditing
- getConfig
- staleness.mjs
- tag-strategy.mjs
- AdminDashboard.tsx
- live-inject.mjs
- event-validation.mjs
- roots.mjs
- insert-ui.mjs
- live-manual-edit-evidence.mjs
- handleManualEditActivity
- manual-edit-routes.mjs
- high_severity.test.ts
- collectBrowserFindings
- runHook
- accept-css.mjs
- svelte-ast.mjs
- impeccable-paths.mjs
- compilerOptions
- TelegramPremium3DStar.tsx
- resolveLengthPx
- sveltekit-adapter.mjs
- live.mjs
- serve-question.mjs
- compilerOptions
- session-store.mjs
- tanstack-adapter.mjs
- sampleCssBackground
- getStaticBannerPath
- generate-image.mjs
- catalog.service.ts
- createLiveBrowserSessionState
- prefs.service.ts
- dependencies
- devDependencies
- Document Reference: DESIGN.md System
- addVisualContrastFindings
- checkHeadingRhythmDOM
- template-extensions.mjs
- mountSvelteComponentVariant
- onAnnotDown
- resolveLiveInjectionAnchor
- createLiveBrowserDomHelpers
- journal.mjs
- surface-briefs.mjs
- context-signals.mjs
- StaticElement
- frameworks/index.mjs
- formatters.ts
- embed-prompt.mjs
- browser-script-parts.mjs
- live-status.mjs
- pin.mjs
- Q: Trace handleManualRail execution path
- scripts
- staleness-notice.mjs
- detect-csp.mjs
- detect-utils.mjs
- generation-preflight.mjs
- palette.mjs
- Doctor Reference: Artifact Health and Repair
- Harden Reference: Production UI Resilience
- detect-html.mjs
- monorepoOwnsPath
- compilerOptions
- Onboard Reference: Time to Value & Empty States
- Layout Reference: Spatial Hierarchy & Rhythm
- readConfig
- normalizeGitHubEvent
- iOS Platform Design Reference
- Overdrive Reference: High-Impact Visuals & Effects
- Knowledge Graph & Architecture Index (Graphify)
- checkElementGptBorderShadowDOM
- WebApp Checkout Screen Banner
- Live Reference: Interactive Browser Variant Mode
- colorFunctionToRgb
- checkHeadingRhythmDOM
- Bot Welcome Banner (Dynamic PNG)
- Production Free-Tier Deployment Guide
- Visualize Reference: Comps & Asset Production
- isScreenReaderOnlyTextStyle
- dotenv
- bot/package.json
- DESIGN.md Format Specification
- scripts
- k6-orders.js
- Polish Reference: UI Refinement Pass
- detect.mjs
- OrderTimeline.tsx
- Dist Asset Bundling Verification Step
- copy-assets.mjs
- k6-catalog.js
- expandScanTargets
- checkCreamPalette
- pino
- provider.mjs
- pdfkit
- pino-pretty
- backup.sh
- vps-setup.sh
- telegram.d.ts
- Append-Only Audit Logs & Session Lifecycle
- CBE SMS Matching Decision Support
- Fail-Closed Production Configuration
- Release v1.0.0: Initial Production Deployment
- Release v1.0.1: Security Hardening
- Release v1.0.2: High-Severity Security Hardening
- Release v1.0.3: Operational Hardening
- Release v1.0.4: Hygiene & Operability Polish
- Knowledge Graph & Architecture Index (Graphify)
- scaffoldSvelteComponentSession
- helmet

## God Nodes (most connected - your core abstractions)
1. `getDatabase()` - 115 edges
2. `createBot()` - 77 edges
3. `getConfig()` - 67 edges
4. `logger` - 53 edges
5. `escapeHtml()` - 47 edges
6. `parseAnyColor()` - 46 edges
7. `parseAnyColor()` - 45 edges
8. `getOrderById()` - 45 edges
9. `isAdmin()` - 44 edges
10. `runHook()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Bank of Abyssinia Payment Icon` --conceptually_related_to--> `handleManualRail()`  [INFERRED]
  webapp/public/icons/abyssinia.jpg → bot/src/bot/handlers/checkout.ts
- `CBE Payment Rail Icon` --conceptually_related_to--> `handleManualRail()`  [INFERRED]
  webapp/public/icons/cbe.jpg → bot/src/bot/handlers/checkout.ts
- `Telebirr Mobile Money Payment Icon` --conceptually_related_to--> `handleManualRail()`  [INFERRED]
  webapp/public/icons/telebirr.jpg → bot/src/bot/handlers/checkout.ts
- `CBE Payment Rail Icon` --conceptually_related_to--> `ParsedCbeSms`  [INFERRED]
  webapp/public/icons/cbe.jpg → bot/src/services/sms_parser.service.ts
- `Telegram Star Design Artwork Mockup` --conceptually_related_to--> `TelegramStar3DIcon()`  [INFERRED]
  star design by you.jpg → webapp/src/components/Icons.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **High-Concurrency Audit, Survey & Remediation Framework** — finding_concurrency_audit_and_work_order, dossier_system_and_codebase_survey, handoff_concurrency_remediation_handoff [EXTRACTED 1.00]
- **Impeccable Foundational Lifecycle Pipeline** — agents_skills_impeccable_reference_init, agents_skills_impeccable_reference_document, agents_skills_impeccable_reference_new_work, agents_skills_impeccable_reference_doctor [EXTRACTED 1.00]
- **Live Interactive HMR Design System** — agents_skills_impeccable_reference_live, agents_skills_impeccable_reference_live_setup, agents_skills_impeccable_reference_polish, agents_skills_impeccable_reference_layout, agents_skills_impeccable_reference_typeset [EXTRACTED 1.00]
- **Impeccable Degraded Inline Agent Subsystem** — _agents_skills_impeccable_reference_degraded_asset_producer_inline_agent, _agents_skills_impeccable_reference_degraded_documenter_inline_agent, _agents_skills_impeccable_reference_degraded_finish_reviewer_inline_agent, _agents_skills_impeccable_reference_degraded_manual_edit_applier_inline_agent [EXTRACTED 1.00]
- **Expressive Refinement and Polish Suite** — _agents_skills_impeccable_reference_bolder_bolder_playbook, _agents_skills_impeccable_reference_delight_delight_playbook, _agents_skills_impeccable_reference_distill_simplification_playbook, _agents_skills_impeccable_reference_clarify_ux_copy_playbook [INFERRED 0.85]
- **Aesthetic Intensity Modulation Spectrum** — agents_skills_impeccable_reference_quieter, agents_skills_impeccable_reference_overdrive, agents_skills_impeccable_reference_operate, agents_skills_impeccable_reference_polish [INFERRED 0.85]
- **Horizontal Scaling & Leader Election Evolution** — docs_multi_region_roadmap_multi_region_evolution, finding_s1_leader_lease_election, docs_multi_region_roadmap_phase_c_postgres_migration [INFERRED 0.85]
- **Zero-Trust Payment Security & State Invariants** — assumptions_server_side_pricing_authority, assumptions_wallet_pay_webhook_trust_model, deploy_readme_runtime_security_controls [INFERRED 0.85]
- **Multi-Platform Quality Assurance and Audit Framework** — _agents_skills_impeccable_reference_audit_web_audit_playbook, _agents_skills_impeccable_reference_audit_native_audit_playbook, _agents_skills_impeccable_reference_craft_floor_baseline_standards, _agents_skills_impeccable_reference_android_platform_guidelines [INFERRED 0.85]

## Communities (163 total, 19 thin omitted)

### Community 0 - "live-browser.js"
Cohesion: 0.03
Nodes (136): acceptedDomAlreadyClean(), applyGlobalBarLabelState(), applyPlaceholderSizingStyles(), averageRgb01(), bindEditBadgeProxy(), bufferToBase64(), buildCollapsible(), buildColorModels() (+128 more)

### Community 1 - "checks.mjs"
Cohesion: 0.03
Nodes (128): ANIMATION_VALUE_KEYWORDS, borderColorsFromStyle(), borderWidthsFromStyle(), buildHtmlPatternCorpora(), checkClippedOverflow(), checkEdgeFlushCardsDOM(), checkElementBlinkingCursorDOM(), checkElementClippedOverflow() (+120 more)

### Community 2 - "context.mjs"
Cohesion: 0.05
Nodes (93): appendAutonomyCounterDirective(), appendBuildPathDirective(), appendDetectorFallback(), appendImageGenDirective(), appendImageToolsDirective(), appendSubagentAuthorizationDirective(), appendSurfaceBriefContext(), automaticHookMode() (+85 more)

### Community 3 - "orders.service.ts"
Cohesion: 0.07
Nodes (39): handleAdminRetryDelivery, isValidTelegramUsername, ACTIVE_PAYMENT_RAILS, ActivePaymentRail, ALLOWED_TRANSITIONS, appendOrderEvent(), createOrder(), CreateOrderInput (+31 more)

### Community 4 - "design-system.mjs"
Cohesion: 0.06
Nodes (78): addClampEndpoints(), addColorObject(), addDesignColor(), addFontSizeStep(), addRoundedScale(), addRoundedToken(), addSidecarColors(), addSidecarRadii() (+70 more)

### Community 5 - "resumeSession"
Cohesion: 0.05
Nodes (87): abortSvelteComponentInjection(), applyParamDefaults(), applyParamValue(), applyPlaceholderDimensions(), applySavedSessionMeta(), buildInsertPlaceholderSnapshotFromDom(), buildParamsPanel(), buildPickedAnchorSnapshot() (+79 more)

### Community 6 - "bot.ts"
Cohesion: 0.09
Nodes (88): createBot(), isAdmin(), promptEditSetting(), promptEditVariantPrice(), promptStockCSV(), promptStockPaste(), executeDirectFulfill(), handleAdminQueueResellerDeliver() (+80 more)

### Community 7 - "detect-antipatterns-browser.js"
Cohesion: 0.05
Nodes (69): browserColorsClose(), browserDesignSystemConfig(), browserHasDirectText(), browserPrimaryFont(), browserRadiusTokens(), browserSampleText(), buildSelectorSegment(), checkBrowserDesignSystemSources() (+61 more)

### Community 8 - "injected/index.mjs"
Cohesion: 0.06
Nodes (69): addBrowserFindings(), addVisualContrastFindings(), addVisualContrastResult(), analyzeVisualContrast(), analyzeVisualContrastCandidate(), blendRgba(), browserColorsClose(), browserDesignSystemConfig() (+61 more)

### Community 9 - "server.ts"
Cohesion: 0.10
Nodes (34): TelegramUser, ValidatedInitData, validateTelegramInitData(), claimIdempotencyKey(), isFirstDelivery(), recordIdempotentResult(), authenticateTelegramUserMiddleware(), buildCorsOptions() (+26 more)

### Community 10 - "live-server.mjs"
Cohesion: 0.07
Nodes (64): eventPriority(), selectAvailablePendingEvent(), acknowledgePendingEvent(), activeSessionSummaries(), agentPollingConnected(), annotRoot, args, broadcast() (+56 more)

### Community 11 - "hook-lib.mjs"
Cohesion: 0.05
Nodes (63): ACK_EXTS, ADVISORY_RULES, ALLOWED_EXTS, applyConfigSource(), applyDetectorConfigSource(), canonicalPath(), canonicalPathCache, clampByte() (+55 more)

### Community 12 - "Icons.tsx"
Cohesion: 0.04
Nodes (40): AdminDashboard, App(), DEFAULT_BOOTSTRAP, AlertCircleIcon(), ArrowUpRightIcon(), BellIcon(), CameraIcon(), CheckCircleIcon() (+32 more)

### Community 13 - "svelte-component.mjs"
Cohesion: 0.07
Nodes (55): collectUnusedSelectors(), verifyAcceptedSource(), applyLegacyDeferredAcceptsOnStartup(), loadSvelteCompiler(), appendCssToSvelteStyle(), appendSanitizedCssRule(), applyDeferredSvelteComponentAccepts(), bakeParamValuesInCss() (+47 more)

### Community 14 - "concept-seed.mjs"
Cohesion: 0.07
Nodes (53): API_BASE, API_TIMEOUT_MS, apiBudgetMs(), dealCompositions(), driveSelection(), fetchRoll(), here, loadLocal() (+45 more)

### Community 15 - "setLiveState"
Cohesion: 0.11
Nodes (56): abandonForeignSession(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure(), cleanup(), cleanupAcceptedSession(), clearAnnotations(), clearInsertPicking() (+48 more)

### Community 16 - "modern-screenshot.umd.js"
Cohesion: 0.07
Nodes (61): ae(), be(), bt(), Ce(), s(), Ct(), de(), dt() (+53 more)

### Community 17 - "el"
Cohesion: 0.07
Nodes (56): actionLabel(), applyConfigureBarChrome(), bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), bindConfigureModifierPillHover(), buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow() (+48 more)

### Community 18 - "css-cascade.mjs"
Cohesion: 0.06
Nodes (44): applyStaticDeclaration(), buildBorderOverrideMap(), parseShorthand(), resolveVar(), buildStaticStyleMap(), buildStaticWindow(), collectStaticCssRules(), compareStaticPriority() (+36 more)

### Community 19 - "detect-text.mjs"
Cohesion: 0.07
Nodes (51): detectLocalFile(), handleStdin(), blankAstroFrontmatterComments(), blankCommentsForMatchers(), blankCssComments(), blankCssLineComments(), blankCssLineCommentsInStyleBlocks(), blankHtmlAndCssCommentsOutsideScripts() (+43 more)

### Community 20 - "parseAnyColor"
Cohesion: 0.08
Nodes (59): checkBorders(), checkColors(), checkElementAIPaletteDOM(), checkElementBorders(), checkElementBordersDOM(), checkElementColors(), checkElementColorsDOM(), checkElementGlowDOM() (+51 more)

### Community 21 - "api/admin.ts"
Cohesion: 0.05
Nodes (57): adminRouter, AdminSessionRequest, fetchFulfilledOrders(), otpFailures, otpLockoutConfig, requireAdminAuth(), requirePermission(), setAdminBotInstance() (+49 more)

### Community 22 - "manual-apply.mjs"
Cohesion: 0.09
Nodes (49): addOpToManualApplyChunk(), APPLY_EVENT_HARD_TIMEOUT_MS, APPLY_EVENT_SOFT_DEADLINE_MS, buildManualApplyAgentAction(), clearManualApplyTransaction(), collectManualApplyFiles(), compactManualApplyBatch(), compactManualApplyCandidates() (+41 more)

### Community 23 - "getDatabase"
Cohesion: 0.05
Nodes (80): getDatabase(), initDatabase(), stmtCache, __dirname, __filename, runMigrations(), seedDatabase(), logger (+72 more)

### Community 24 - "api.ts"
Cohesion: 0.13
Nodes (27): BootstrapData, createOrderApi(), CreateOrderOptions, CreateOrderResponse, fetchBootstrap(), fetchOrders(), fetchReferralsApi(), fetchSupportMessages() (+19 more)

### Community 25 - "detect-antipatterns.mjs"
Cohesion: 0.09
Nodes (40): confirm(), detectCli(), dim(), fileUrlToLocalPath(), formatAdvisorySection(), formatFindings(), formatFindingsBody(), formatFindingSummary() (+32 more)

### Community 26 - "live-commit-manual-edits.mjs"
Cohesion: 0.10
Nodes (49): allEntryIds(), argVal(), buildRepairBatch(), candidatesForEntry(), changedFilesSinceSnapshot(), clearAppliedEntries(), collectApplyOwnedFiles(), collectRollbackFiles() (+41 more)

### Community 27 - "initPageChat"
Cohesion: 0.09
Nodes (48): armPageChatForTyping(), attachSteerFocusDebug(), attachSteerFocusGuard(), buildSteerProcessingDots(), buildSteerQueueHint(), clearSteerAwaitTimer(), clearSteerFocusRecoverTimer(), collapsePageChat() (+40 more)

### Community 28 - "Skill Command Routing Architecture"
Cohesion: 0.06
Nodes (47): OpenAI Agent Interface Configuration, Contextual Rethinking Over Scaling, Native Adaptive Navigation Paradigms, Native Multi-Device Adaptation Playbook, Responsive Layout Adaptation Techniques, Web Responsive Adaptation Playbook, Material Design 3 Architecture, Android Platform Design Guidelines (+39 more)

### Community 29 - "detect-url.mjs"
Cohesion: 0.19
Nodes (20): createBrowserDetector(), detectUrl(), launchBrowser(), measureContentHiddenAfterReveal(), runVisualContrastFallback(), serializeDesignSystemForBrowser(), captureVisualContrastCandidate(), compareScreenshotContrast() (+12 more)

### Community 30 - "hook-before-edit.mjs"
Cohesion: 0.13
Nodes (34): allow(), bumpCursorDenial(), cursorBlockMessage(), deny(), detectProposedHtml(), done(), escapeRegExp(), findingSignature() (+26 more)

### Community 31 - "impeccable-config.mjs"
Cohesion: 0.10
Nodes (45): applyDetectionConfigSource(), clampByte(), cleanIgnoreValueDisplay(), cloneDetectionConfig(), cloneRawDetectionConfig(), COLOR_CHANNEL_FORMATS, colorIgnoreKey(), DEFAULT_DETECTION_CONFIG (+37 more)

### Community 32 - "Executable Work Order & Concurrency Audit"
Cohesion: 0.05
Nodes (46): Architectural & Technical Assumptions Document, Ink & Jade Design System Tokens, Order State Machine Invariants, RBAC Permission Matrix & Auto-Backfill, Two-Tier Referral Double-Entry Ledger, Server-Side Pricing Authority, SQLite WAL Mode & Persistence Strategy, Wallet Pay Webhook Trust Model (+38 more)

### Community 33 - "start.ts"
Cohesion: 0.10
Nodes (46): checkChannelMembership(), getRequiredChannelLink(), getRequiredChannelUsername(), handleOnboardingChannelCheck(), handleOnboardingLanguage(), membershipCache, promptChannelSubscription(), promptLanguageSelection() (+38 more)

### Community 34 - "devDependencies"
Cohesion: 0.04
Nodes (45): buffer, lucide-react, puppeteer-core, react, react-dom, @telegram-apps/sdk-react, three, @ton/core (+37 more)

### Community 35 - "reseller_cascade.test.ts"
Cohesion: 0.06
Nodes (43): AppConfig, assertClosed(), breakerFor(), breakers, BreakerState, CircuitOpenError, fetchJson(), hardenedFetch() (+35 more)

### Community 36 - "hook-admin.mjs"
Cohesion: 0.12
Nodes (42): ACTIONS, addIgnoreFile(), addIgnoreRule(), addIgnoreValue(), DETECTOR_CONFIG_KEYS, detectorSection(), fileHasImpeccableHookMarker(), HOOK_MANIFEST_TARGETS (+34 more)

### Community 37 - "initGlobalBar"
Cohesion: 0.08
Nodes (42): agentHasWorkInFlight(), agentStatusText(), barPaletteForTheme(), brandMarkSvg(), buildDesignHeader(), cursorForInsertAxis(), designPanelCss(), detectPageTheme() (+34 more)

### Community 38 - "live-copy-edit-agent.mjs"
Cohesion: 0.12
Nodes (42): applyMockWrites(), buildCopyEditBatchPrompt(), checkFrameworkSourceSyntax(), chooseCopyEditAgent(), COMMAND_AUTH_CACHE, commandAuthed(), commandExists(), compactBatchCandidates() (+34 more)

### Community 39 - "live-wrap.mjs"
Cohesion: 0.13
Nodes (38): resolveLiveTemplateExtensions(), findSessionFile(), resolveSourceTraits(), argVal(), buildInsertWrapperLines(), computeInsertLine(), INSERT_POSITIONS, insertCli() (+30 more)

### Community 40 - "live-accept.mjs"
Cohesion: 0.12
Nodes (39): safeSessionId(), acceptCli(), acceptReceiptPath(), argVal(), buildAcceptedWrappedSource(), buildCarbonizeReplacement(), decodeHtmlAttr(), deindentContent() (+31 more)

### Community 41 - "live-poll.mjs"
Cohesion: 0.11
Nodes (37): completionAckForAcceptResult(), completionTypeForAcceptResult(), PREVIEW_MODES_WITHOUT_SOURCE_MARKERS, acceptInstructions(), deferredWrapperInstructions(), generateInstructions(), insertScaffoldInstructions(), instructionsForEvent() (+29 more)

### Community 42 - "maintenance.test.ts"
Cohesion: 0.08
Nodes (34): serveOrderReceipt(), syncAdminsFromEnv(), closeDatabase(), releaseLease(), tryAcquireLease(), main(), prewarmAllBanners(), startLifecycleJobs() (+26 more)

### Community 43 - "scanCssTextForPulsingDot"
Cohesion: 0.09
Nodes (39): buildHtmlPatternCorpora(), checkColors(), checkElementGlow(), checkElementRadialSpotlight(), checkElementRadialSpotlightDOM(), checkGlow(), checkHtmlPatterns(), checkRadialSpotlight() (+31 more)

### Community 44 - "parseAnyColor"
Cohesion: 0.11
Nodes (39): checkElementAIPaletteDOM(), checkElementColors(), checkElementColorsDOM(), checkElementGlowDOM(), checkElementHoverContrast(), checkElementIconTile(), checkElementIconTileDOM(), checkHoverContrast() (+31 more)

### Community 45 - "design-parser.mjs"
Cohesion: 0.14
Nodes (37): assessCoverage(), buildColor(), CANONICAL_SECTIONS, collectBullets(), collectColorValues(), collectParagraphs(), detectFormat(), extractColors() (+29 more)

### Community 46 - "doctor.mjs"
Cohesion: 0.12
Nodes (34): extractPlatform(), hasVisualImplementation(), loadContext(), applyFixes(), cli(), collect(), parseArgs(), readProjectRootPatterns() (+26 more)

### Community 47 - "applyEditing"
Cohesion: 0.08
Nodes (35): addManualContextText(), applyEditing(), buildLocatorForLeaf(), canRestoreManualEditElement(), collectEditableTextRows(), visit(), contextElementForManualEdit(), copyEditContainerContext() (+27 more)

### Community 48 - "getConfig"
Cohesion: 0.11
Nodes (19): getConfig(), chapaInitialize(), ChapaInitializeParams, chapaQueryStatus(), isChapaEnabled(), verifyChapaSignature(), fetchTreasuryTransactions(), isTonConnectEnabled() (+11 more)

### Community 49 - "staleness.mjs"
Cohesion: 0.14
Nodes (27): DESIGN_SIDECAR_SCHEMA_VERSION, PRODUCT_DEPRECATED_SECTIONS, PRODUCT_SCHEMA_VERSION, PRODUCT_V4_SECTIONS, productStampLine(), readProductSchemaVersion(), readSidecarSchemaVersion(), stampProductSchema() (+19 more)

### Community 50 - "tag-strategy.mjs"
Cohesion: 0.20
Nodes (17): appendOriginToDirective(), buildTagBlock(), commentClose(), commentOpen(), detectLineEnding(), findCspMetaTags(), getAttr(), insertTag() (+9 more)

### Community 51 - "AdminDashboard.tsx"
Cohesion: 0.08
Nodes (44): addStockLinksApi(), adminFetch(), adminLoginApi(), adminLogoutApi(), adminVerify2FAApi(), approveOrderApi(), broadcastMessageApi(), broadcastStatusApi() (+36 more)

### Community 52 - "live-inject.mjs"
Cohesion: 0.16
Nodes (19): describeInjectArtifacts(), frameworkIgnorePatterns(), resolveFramework(), applyNuxtLiveAdapter(), buildNuxtPlugin(), detectNuxtProject(), NUXT_PLUGIN_MARKER, NUXT_PLUGIN_NAME (+11 more)

### Community 53 - "event-validation.mjs"
Cohesion: 0.12
Nodes (26): AGENT_PHASE_SET, FORBIDDEN_MANUAL_EDIT_TEXT_CHARS, INSERT_POSITIONS, isValidId(), isValidMountVariant(), isValidVariantId(), MOUNT_ERROR_MAX_LENGTH, MOUNT_URL_MAX_LENGTH (+18 more)

### Community 54 - "roots.mjs"
Cohesion: 0.15
Nodes (27): CANDIDATE_SCAN_IGNORED, consumeTargetArg(), CONTEXT_FALLBACK_DIRS, DESIGN_NAMES, DEV_CONFIG_MARKERS, discoverAppCandidates(), enterLiveRoot(), exists() (+19 more)

### Community 55 - "insert-ui.mjs"
Cohesion: 0.09
Nodes (13): canCreateInsert(), clampPlaceholderSize(), computeInsertPosition(), groupSiblingRows(), hitSiblingInsertGap(), horizontalOverlap(), insertCreateDisabledReason(), insertLineCoords() (+5 more)

### Community 56 - "live-manual-edit-evidence.mjs"
Cohesion: 0.13
Nodes (30): hasGeneratedHeader(), HEADER_MARKERS, isGeneratedFile(), isGitIgnored(), analyzeSourceHint(), buildCandidatesForOp(), buildContextHintsByRef(), buildManualEditEvidence() (+22 more)

### Community 57 - "handleManualEditActivity"
Cohesion: 0.18
Nodes (26): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+18 more)

### Community 58 - "manual-edit-routes.mjs"
Cohesion: 0.18
Nodes (21): args, buffer, cwd, pageUrlFilter, remaining, compactManualLogText(), summarizeManualApplyFailures(), summarizeManualDiagnostics() (+13 more)

### Community 59 - "high_severity.test.ts"
Cohesion: 0.06
Nodes (31): __dirname, EnvSchema, __filename, loadEnv(), resolveEnvCandidates(), getWalletPayAdapter(), reconcileStuckWalletPayOrders, resetWalletPayAdapter() (+23 more)

### Community 60 - "collectBrowserFindings"
Cohesion: 0.12
Nodes (25): browserFindingsFromMap(), checkBorders(), checkEdgeFlushCardsDOM(), checkElementBlinkingCursorDOM(), checkElementBorders(), checkElementBordersDOM(), checkElementPseudoStripeDOM(), checkElementTextOverflowDOM() (+17 more)

### Community 61 - "runHook"
Cohesion: 0.11
Nodes (38): appendDesignSystemNote(), appendDesignSystemNoteOnce(), bumpEditCount(), clampGroupedToBudget(), clampLastLine(), clampToBudget(), commitFooterShown(), consumeSessionNoticeFlag() (+30 more)

### Community 62 - "accept-css.mjs"
Cohesion: 0.24
Nodes (20): bakeParamValues(), collectAllSelectors(), collectSelectorsFromNodes(), escapeRegExp(), formatBody(), isToggleOn(), normalizeSelector(), normalizeToggleForVar() (+12 more)

### Community 63 - "svelte-ast.mjs"
Cohesion: 0.21
Nodes (20): Analysis, analyzeAttributes(), analyzeFragment(), analyzeNode(), analyzeSvelteMarkup(), applyReplacements(), classifyEachKey(), classifyRoots() (+12 more)

### Community 64 - "impeccable-paths.mjs"
Cohesion: 0.10
Nodes (35): resolveProjectRoot(), CRITIQUE_DIR, firstExisting(), getDesignSidecarCandidates(), getDesignSidecarPath(), getImpeccableDir(), getLegacyLiveAnnotationsDir(), getLegacyLiveConfigPath() (+27 more)

### Community 65 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 66 - "TelegramPremium3DStar.tsx"
Cohesion: 0.36
Nodes (5): createSparkleGeometry(), createTelegramStarShape(), TelegramPremium3DStar(), TelegramPremium3DStarProps, haptic

### Community 67 - "resolveLengthPx"
Cohesion: 0.12
Nodes (22): checkElementHeroEyebrow(), checkElementHeroEyebrowDOM(), checkElementQualityDOM(), checkHeroEyebrow(), checkKickerAboveHeading(), checkKickerAboveHeadingDOM(), checkKickerAboveHeadingFromDoc(), checkNumberedSectionLabels() (+14 more)

### Community 68 - "sveltekit-adapter.mjs"
Cohesion: 0.19
Nodes (20): firstExistingFile(), applySvelteKitLiveAdapter(), buildSvelteLiveRootComponent(), defaultSvelteLayout(), detectSvelteKitProject(), ensureSvelteLiveRootComponent(), escapeRegExp(), fileIncludes() (+12 more)

### Community 69 - "live.mjs"
Cohesion: 0.18
Nodes (17): parseCliOptions(), parseTargetOptions(), parseTargetPath(), TargetArgError, __dirname, ensureServerRunning(), globToRegex(), globToRegex() (+9 more)

### Community 70 - "serve-question.mjs"
Cohesion: 0.14
Nodes (17): browserOpenCommand(), openSystemBrowser(), answerFile(), esc(), flipFile(), idleGraceArg, loadRound(), localImages (+9 more)

### Community 71 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir (+12 more)

### Community 72 - "session-store.mjs"
Cohesion: 0.14
Nodes (23): FORBIDDEN, verifyAcceptedFile(), completeCli(), completeThroughServer(), parseArgs(), readServerInfo(), applyEvent(), baseSnapshot() (+15 more)

### Community 73 - "tanstack-adapter.mjs"
Cohesion: 0.17
Nodes (18): tanstackStart, applyTanStackLiveAdapter(), buildTanStackLiveRootComponent(), detectTanStackStartProject(), escapeRegExp(), insertAfterLastImport(), isManagedComponent(), patchTanStackRoot() (+10 more)

### Community 74 - "sampleCssBackground"
Cohesion: 0.16
Nodes (18): analyzeVisualContrastCandidate(), blendRgba(), clampByte(), firstCssUrl(), getLayerValue(), loadVisualContrastImage(), parseObjectPosition(), parsePositionPair() (+10 more)

### Community 75 - "getStaticBannerPath"
Cohesion: 0.15
Nodes (18): Bot Gemini Banner (Dynamic PNG), Bot Telegram Premium Banner (Dynamic PNG), Bot Gemini Static Banner, Bot Telegram Premium Static Banner, Bot Telegram Stars Static Banner, getStaticBannerPath(), Telegram Star Design Artwork Mockup, WebApp Gemini Pro Product Banner (+10 more)

### Community 76 - "generate-image.mjs"
Cohesion: 0.17
Nodes (13): crc32(), hash32(), hslToRgb(), out, palette(), pngChunk(), pngFake(), promptFile (+5 more)

### Community 77 - "catalog.service.ts"
Cohesion: 0.19
Nodes (15): inlineQueryHandler(), getAllProducts(), getVariantById(), Product, setProductActive(), updateVariantPrice(), Variant, Tier (+7 more)

### Community 78 - "createLiveBrowserSessionState"
Cohesion: 0.20
Nodes (14): createLiveBrowserSessionState(), clearHandled(), clearScrollY(), clearSession(), isHandled(), loadSession(), markHandled(), nextCheckpointRevision() (+6 more)

### Community 79 - "prefs.service.ts"
Cohesion: 0.53
Nodes (5): cloud(), loadPrefs(), loadPrefsSync(), savePrefs(), UserPrefs

### Community 80 - "dependencies"
Cohesion: 0.12
Nodes (17): better-sqlite3, dependencies, better-sqlite3, cors, exceljs, express, express-rate-limit, grammy (+9 more)

### Community 81 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, tsx, @types/better-sqlite3, @types/cors, @types/express, @types/node, @types/pdfkit, typescript (+9 more)

### Community 82 - "Document Reference: DESIGN.md System"
Cohesion: 0.16
Nodes (16): Document Reference: DESIGN.md System, Eight Canonical Markdown Sections, Design JSON Sidecar Extension, Scan Mode Extraction Flow, Seed Mode Design Generation, Design Token Frontmatter Schema, Init Reference: Product Truth & Setup, Project Initialization Workflow (+8 more)

### Community 83 - "addVisualContrastFindings"
Cohesion: 0.16
Nodes (16): addBrowserFindings(), addVisualContrastFindings(), addVisualContrastResult(), analyzeVisualContrast(), clearOverlays(), detachOverlay(), disconnectLazyVisualContrastObserver(), postExtensionError() (+8 more)

### Community 84 - "checkHeadingRhythmDOM"
Cohesion: 0.18
Nodes (16): checkHeadingRhythmDOM(), clusterTop(), edgeAbove(), edgeBelow(), hasOwnTopBoundary(), insideSmallCard(), isVisibleFlow(), overlapsX() (+8 more)

### Community 85 - "template-extensions.mjs"
Cohesion: 0.36
Nodes (6): extensionCache, LIVE_TEMPLATE_EXTENSIONS, mergeExtensions(), normalizeExtensionEntries(), readLiveTemplateExtensions(), safeReadJson()

### Community 86 - "mountSvelteComponentVariant"
Cohesion: 0.19
Nodes (14): applyOriginalAttrsToSvelteAnchor(), commitAcceptedSvelteComponentToDom(), componentModuleCandidates(), describeMountFailure(), detectDevServerBase(), importFirstReachable(), loadSvelteRuntime(), maybePrefetchPage() (+6 more)

### Community 87 - "onAnnotDown"
Cohesion: 0.24
Nodes (15): beginEditPin(), buildAnnotationsForCapture(), buildPinElement(), cancelEditingPin(), finalizeEditingPin(), initAnnotOverlay(), localCoords(), onAnnotDown() (+7 more)

### Community 88 - "resolveLiveInjectionAnchor"
Cohesion: 0.22
Nodes (15): buildSvelteExpressionTextMap(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), cloneWithoutElements(), collectTextNodes(), collectVisibleTexts(), cssEscapeIdent(), elementMatchesOriginalMarkup() (+7 more)

### Community 89 - "createLiveBrowserDomHelpers"
Cohesion: 0.19
Nodes (10): createLiveBrowserDomHelpers(), cssId(), liveUiRoot(), makeFrozenAnchor(), own(), pickable(), rectIsUsableAnchor(), uiAppend() (+2 more)

### Community 90 - "journal.mjs"
Cohesion: 0.26
Nodes (14): PATCH_UNDOERS, clearInjectJournal(), healArtifact(), healInjectJournal(), INJECT_JOURNAL_RELPATH, INJECT_JOURNAL_VERSION, injectJournalPath(), insideProject() (+6 more)

### Community 91 - "surface-briefs.mjs"
Cohesion: 0.29
Nodes (13): getSurfaceBriefDir(), listSurfaceBriefs(), normalizeRouteTarget(), normalizeSurfaceTarget(), parseSurfaceBrief(), resolveSurfaceBrief(), SURFACE_BRIEF_VERSION, surfaceBriefPathForTarget() (+5 more)

### Community 92 - "context-signals.mjs"
Cohesion: 0.14
Nodes (24): cli(), COMMON_DEV_PORTS, devServerSignals(), gatherSignals(), gitSignals(), hasCode(), isVendoredPath(), latestCritique() (+16 more)

### Community 94 - "frameworks/index.mjs"
Cohesion: 0.14
Nodes (13): astro, COMMENT_SYNTAXES, FRAMEWORKS, INJECT_KINDS, PREVIEW_MODES, SOURCE_TRAIT_DEFAULTS, STYLE_MODES, TAG_PATCH_KIND (+5 more)

### Community 95 - "formatters.ts"
Cohesion: 0.18
Nodes (9): formatBankPaymentInstructions(), formatBlockquote(), formatBrandHeader(), formatCheckoutSummary(), formatDeliveryMessage(), formatPriceETB(), formatRow(), PaymentRailInfo (+1 more)

### Community 96 - "embed-prompt.mjs"
Cohesion: 0.19
Nodes (11): args, buf, crc32(), crcTable, file, pngChunk(), promptOf(), readJpegCom() (+3 more)

### Community 97 - "browser-script-parts.mjs"
Cohesion: 0.19
Nodes (10): assembleLiveBrowserScript(), assertLiveBrowserScriptParts(), LIVE_BROWSER_SCRIPT_PARTS, readLiveBrowserScriptParts(), resolveLiveBrowserScriptParts(), loadBrowserScripts(), LIVE_CHROME_MOUNT_CONTRACT, LIVE_UI_COMPONENT_IDS (+2 more)

### Community 98 - "live-status.mjs"
Cohesion: 0.30
Nodes (13): collectManualApplyFiles(), manualApplyReplyCommand(), manualApplyResumeHint(), mountFailureAction(), parseArgs(), renderSummary(), resumeCli(), summarizeManualApplyEvent() (+5 more)

### Community 99 - "pin.mjs"
Cohesion: 0.22
Nodes (11): CODEX_HARNESSES, commandPrefixForSkillsDir(), __dirname, findHarnessDirs(), generatePinnedSkill(), HARNESS_DIRS, loadCommandMetadata(), pin() (+3 more)

### Community 100 - "Q: Trace handleManualRail execution path"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Trace handleManualRail execution path, Source Nodes

### Community 101 - "scripts"
Cohesion: 0.14
Nodes (13): name, private, scripts, bot:dev, bot:start, bot:test, build, start (+5 more)

### Community 102 - "staleness-notice.mjs"
Cohesion: 0.33
Nodes (10): appendStalenessDirective(), collectBootFindings(), buildStalenessDirective(), cachePath(), filterFreshFindings(), pruneCache(), readCache(), readJson() (+2 more)

### Community 103 - "detect-csp.mjs"
Cohesion: 0.20
Nodes (10): detectCsp(), INLINE_HEADER_SIGNALS, LAYOUT_EXTS, MONOREPO_HELPER_SIGNALS, NUXT_ROUTE_RULES_SIGNALS, NUXT_SECURITY_SIGNALS, SCAN_EXTS, SKIP_DIRS (+2 more)

### Community 104 - "detect-utils.mjs"
Cohesion: 0.41
Nodes (9): detectAstroProject(), fileExists(), findConfigFile(), hasAnyDependency(), literalConfigFiles(), readPackageDeps(), detectNextProject(), ROUTER_ENTRY_CANDIDATES (+1 more)

### Community 105 - "generation-preflight.mjs"
Cohesion: 0.35
Nodes (9): buildGenerationPreflight(), compactError(), execFileAsync, insertTarget(), normalizeTarget(), replaceTarget(), runGenerationPreflight(), sourceResolutionCache (+1 more)

### Community 106 - "palette.mjs"
Cohesion: 0.24
Nodes (7): args, buildWeights(), hashUnit(), pickSeed(), seed, SEEDS, weightedPick()

### Community 107 - "Doctor Reference: Artifact Health and Repair"
Cohesion: 0.22
Nodes (10): Doctor Reference: Artifact Health and Repair, Artifact Drift Detection, Deprecated Schema Fields Binding Rule, Doctor Health Audit Pass, Severity-Based Action Taxonomy, Hooks Reference: Design Detector Integration, Impeccable Design Detector Hook, Agent Harness Integration (+2 more)

### Community 108 - "Harden Reference: Production UI Resilience"
Cohesion: 0.20
Nodes (10): Harden Reference: Production UI Resilience, Accessibility and Focus Resilience, Hardening Needs Assessment, Error Boundary and Inline Error Handling, Internationalization and RTL Support, Text Overflow and Wrapping Handling, Optimize Reference: UI Performance & Web Vitals, Asset Loading and Resource Prioritization (+2 more)

### Community 109 - "detect-html.mjs"
Cohesion: 0.10
Nodes (25): collectStaticCssText(), checkStaticPageTypography(), detectHtml(), STATIC_ELEMENT_RULES, checkCreamPalette(), checkElementGlow(), checkPageLayout(), checkPageQualityDOM() (+17 more)

### Community 110 - "monorepoOwnsPath"
Cohesion: 0.53
Nodes (9): monorepoOwnsPath(), escapeRegExp(), groupOwns(), matchesNegation(), matchGlobSegments(), rec(), normalizeWorkspacePattern(), positiveOwns() (+1 more)

### Community 111 - "compilerOptions"
Cohesion: 0.20
Nodes (9): vite.config.ts, compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, strict (+1 more)

### Community 112 - "Onboard Reference: Time to Value & Empty States"
Cohesion: 0.22
Nodes (9): Product Truth Discovery Interview, Onboard Reference: Time to Value & Empty States, Aha Moment Discovery Path, Contextual Empty State Design, Core Onboarding Principles, Shape Reference: Discovery Interview and Briefing, Confirmed Design Brief Document, Design Direction Resolution (+1 more)

### Community 113 - "Layout Reference: Spatial Hierarchy & Rhythm"
Cohesion: 0.25
Nodes (9): Layout Reference: Spatial Hierarchy & Rhythm, Visual Rhythm and Grid Alignment, Spatial Thesis Definition, Layout Strategy by Visitor Mode, Craft Dimensions (Type, Color, Spacing, State), Typeset Reference: Typographic Systems, Typographic Hierarchy & Modular Scale, Typography Rules by Visitor Mode (+1 more)

### Community 114 - "readConfig"
Cohesion: 0.25
Nodes (10): cloneDefaultConfig(), detectorSection(), hookSection(), isStopEvent(), readConfig(), safeReadJson(), writeAuditLog(), main() (+2 more)

### Community 115 - "normalizeGitHubEvent"
Cohesion: 0.43
Nodes (7): applyPatchText(), envProjectDir(), looksLikeApplyPatch(), normalizeGitHubEvent(), normalizeGrokEvent(), normalizeHookEvent(), parseGitHubToolArgs()

### Community 116 - "iOS Platform Design Reference"
Cohesion: 0.25
Nodes (8): iOS Platform Design Reference, Human Interface Guidelines Conformance, iOS Blur Materials and Haptics, iOS Slop Test Checklist, Operate Mode Depth Reference, Information Density and Tabular Alignment, Operate Mode Functional UI Design, Product UI Slop Test

### Community 117 - "Overdrive Reference: High-Impact Visuals & Effects"
Cohesion: 0.25
Nodes (8): Overdrive Reference: High-Impact Visuals & Effects, Overdrive Mode Execution, Non-Negotiable Progressive Enhancement, Advanced Frontend Toolkit (Canvas, Shaders, Physics), Quieter Reference: Visual Restraint and De-escalation, Quiet Design Refinement Workflow, Typographic Breathing Room & Contrast Softening, Visual Weight and Intensity Reduction

### Community 118 - "Knowledge Graph & Architecture Index (Graphify)"
Cohesion: 0.50
Nodes (3): Knowledge Graph & Architecture Index (Graphify), Mandatory Navigation Workflow:, Workspace Instructions (Codex CLI & AI Agents)

### Community 119 - "checkElementGptBorderShadowDOM"
Cohesion: 0.32
Nodes (8): borderColorsFromStyle(), borderWidthsFromStyle(), checkElementGptBorderShadow(), checkElementGptBorderShadowDOM(), checkGptThinBorderWideShadow(), cssColorAlpha(), shadowLayerAlpha(), shadowMaxBlurPx()

### Community 120 - "WebApp Checkout Screen Banner"
Cohesion: 0.22
Nodes (9): Bot Checkout Static Banner, ParsedCbeSms, WebApp Checkout Screen Banner, Bank of Abyssinia Payment Icon, CBE Payment Rail Icon, Telebirr Mobile Money Payment Icon, PaymentAbyssiniaIcon(), PaymentCbeIcon() (+1 more)

### Community 121 - "Live Reference: Interactive Browser Variant Mode"
Cohesion: 0.29
Nodes (7): Live Reference: Interactive Browser Variant Mode, Live Command Polling Loop, Live Setup Reference: Config & CSP, Live Mode Configuration File, Live Config Drift Resolution, Content Security Policy Injection Handling, Live Variant Session Protocol

### Community 122 - "colorFunctionToRgb"
Cohesion: 0.33
Nodes (7): clamp01(), colorFunctionToRgb(), decodeSrgbChannel(), encodeSrgbChannel(), linearSrgbToColor(), oklabToRgb(), oklchToRgb()

### Community 123 - "checkHeadingRhythmDOM"
Cohesion: 0.62
Nodes (7): checkHeadingRhythmDOM(), clusterTop(), edgeAbove(), edgeBelow(), hasOwnTopBoundary(), isVisibleFlow(), overlapsX()

### Community 124 - "Bot Welcome Banner (Dynamic PNG)"
Cohesion: 0.47
Nodes (6): Bot Welcome Banner (Dynamic PNG), Bot Welcome Static Banner, Bot Start Flow Design Mockup, WebApp Welcome Header Banner, BigHabesha Brand Logo SVG Icon, LogoIcon()

### Community 125 - "Production Free-Tier Deployment Guide"
Cohesion: 0.29
Nodes (7): Cloudflare Tunnel Ingress Configuration, Automated SQLite Online Backup & Disaster Recovery Drill, Cloudflare Pages SPA Hosting Architecture, Cloudflare Tunnel Ingress Architecture, Production Free-Tier Deployment Guide, Runtime Security Architecture Matrix, Ubuntu VPS & PM2 Runtime Topology

### Community 126 - "Visualize Reference: Comps & Asset Production"
Cohesion: 0.33
Nodes (6): Three-Variant Planning Methodology, Visualize Reference: Comps & Asset Production, Asset Fidelity and Materiality Inventory, Three Directional Visual Comps, Medium Selection Gate (Code vs Raster), Asset Prompt Provenance Embedding

### Community 127 - "isScreenReaderOnlyTextStyle"
Cohesion: 0.47
Nodes (6): clippedByInset(), clippedByRect(), expandBoxShorthand(), firstMetricLengthPx(), isScreenReaderOnlyTextStyle(), metricLengthPx()

### Community 129 - "bot/package.json"
Cohesion: 0.33
Nodes (5): main, name, private, type, version

### Community 130 - "DESIGN.md Format Specification"
Cohesion: 0.40
Nodes (5): DESIGN.md Format Specification, Extract Flow Reference, Component Migration Strategy, Design System Extraction Flow, UI Pattern Identification

### Community 131 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, start, test

### Community 133 - "Polish Reference: UI Refinement Pass"
Cohesion: 0.50
Nodes (4): Hook Findings Triage Protocol, Polish Reference: UI Refinement Pass, Systematic UI Polish Flow, Visual Bug and Defect Triage

### Community 134 - "detect.mjs"
Cohesion: 0.50
Nodes (3): candidates, detectorPath, __dirname

### Community 135 - "OrderTimeline.tsx"
Cohesion: 0.23
Nodes (9): AdminOrder, formatResellerBadge(), ResellerBadge(), ResellerBadgeProps, OrderItem, OrderEvent, OrderTimeline(), stepIndexFor() (+1 more)

### Community 136 - "Dist Asset Bundling Verification Step"
Cohesion: 0.50
Nodes (4): Monorepo Structure with pnpm Workspaces, GitHub Actions CI Workflow, Dist Asset Bundling Verification Step, CI Quality Gate Job (Typecheck, Build, Test)

### Community 137 - "copy-assets.mjs"
Cohesion: 0.50
Nodes (3): botRoot, copyJobs, __dirname

### Community 139 - "expandScanTargets"
Cohesion: 0.53
Nodes (6): coLocatedStylesheets(), expandScanTargets(), hasPathTraversal(), isInsideProject(), normalizeScanTargets(), parseStaticStyleImports()

### Community 140 - "checkCreamPalette"
Cohesion: 1.00
Nodes (3): checkCreamPalette(), creamFromClassList(), isCreamColor()

### Community 142 - "provider.mjs"
Cohesion: 0.50
Nodes (3): IMPECCABLE_COMMAND, IMPECCABLE_COMMAND_PREFIX, IMPECCABLE_PROVIDER_ID

### Community 159 - "Knowledge Graph & Architecture Index (Graphify)"
Cohesion: 0.50
Nodes (3): Knowledge Graph & Architecture Index (Graphify), Mandatory Navigation Workflow:, Workspace Instructions (Codex CLI & AI Agents)

### Community 160 - "scaffoldSvelteComponentSession"
Cohesion: 0.40
Nodes (5): buildPropsScriptV2(), buildVariantStubV2(), ensureRuntimeHelper(), safeReadSource(), scaffoldSvelteComponentSession()

## Knowledge Gaps
- **587 isolated node(s):** `here`, `API_BASE`, `API_TIMEOUT_MS`, `localStates`, `PING_KINDS` (+582 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleManualRail()` connect `bot.ts` to `WebApp Checkout Screen Banner`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `createBot()` (e.g. with `renderAdminMenu()` and `healthHandler()`) actually correct?**
  _`createBot()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `here`, `API_BASE`, `API_TIMEOUT_MS` to the rest of the system?**
  _587 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `live-browser.js` be split into smaller, more focused modules?**
  _Cohesion score 0.02845657463239183 - nodes in this community are weakly interconnected._
- **Should `checks.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.029829712272460365 - nodes in this community are weakly interconnected._
- **Should `context.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.046360582306830905 - nodes in this community are weakly interconnected._
- **Should `orders.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06956521739130435 - nodes in this community are weakly interconnected._