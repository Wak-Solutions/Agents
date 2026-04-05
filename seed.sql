-- ============================================================
--  WAK Dashboard — Seed Script
--  Fake data for dev / demo: 10 chats, 4 meetings, 6 survey responses
--
--  Safe to run:
--    • Skips automatically if seed data is already present
--      (guard key: escalation with phone '+966501110001')
--    • All phones use the pattern +96650111xxxx — easy to clean up
--
--  Pre-requisites:
--    • At least 1 admin + 1 agent must exist in the agents table
--    • App must have been started at least once so the default survey exists
--    • fix_schema.sql must have been applied (escalations.id is a SERIAL PK)
--
--  To reset (delete seed data only):
--    DELETE FROM survey_answers   sa USING survey_responses sr
--      WHERE sa.response_id = sr.id AND sr.customer_phone LIKE '+96650111%';
--    DELETE FROM survey_responses WHERE customer_phone LIKE '+96650111%';
--    DELETE FROM meetings         WHERE customer_phone LIKE '+96650111%';
--    DELETE FROM messages         WHERE customer_phone LIKE '+96650111%';
--    DELETE FROM escalations      WHERE customer_phone LIKE '+96650111%';
-- ============================================================

BEGIN;

DO $$
DECLARE
  -- Agent IDs (fetched dynamically — never hardcoded)
  v_admin_id   INTEGER;
  v_agent1_id  INTEGER;
  v_agent2_id  INTEGER;

  -- Default survey + question IDs
  v_survey_id  INTEGER;
  v_q_rating   INTEGER;
  v_q_yesno    INTEGER;
  v_q_text     INTEGER;

  -- Escalation IDs (returned from INSERTs)
  v_e1  INTEGER;  v_e2  INTEGER;  v_e3  INTEGER;  v_e4  INTEGER;
  v_e5  INTEGER;  v_e6  INTEGER;  v_e7  INTEGER;  v_e8  INTEGER;
  v_e9  INTEGER;  v_e10 INTEGER;

  -- Meeting IDs
  v_m1 INTEGER;  v_m2 INTEGER;  v_m3 INTEGER;  v_m4 INTEGER;

  -- Survey response IDs
  v_sr1 INTEGER;  v_sr2 INTEGER;  v_sr3 INTEGER;
  v_sr4 INTEGER;  v_sr5 INTEGER;  v_sr6 INTEGER;

BEGIN

  -- ── Guard ──────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM escalations WHERE customer_phone = '+966501110001') THEN
    RAISE NOTICE 'Seed data already present — skipping. '
                 'Delete rows with customer_phone LIKE ''+96650111%%'' to reseed.';
    RETURN;
  END IF;

  -- ── Resolve agent IDs ──────────────────────────────────────────────────────
  SELECT id INTO v_admin_id
    FROM agents WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1;

  SELECT id INTO v_agent1_id
    FROM agents WHERE role = 'agent' AND is_active = true ORDER BY id LIMIT 1;

  SELECT id INTO v_agent2_id
    FROM agents WHERE role = 'agent' AND is_active = true ORDER BY id OFFSET 1 LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No active admin found. Start the app once to seed the default admin.';
  END IF;
  IF v_agent1_id IS NULL THEN
    -- Fall back: use admin as the only agent
    v_agent1_id := v_admin_id;
    v_agent2_id := v_admin_id;
    RAISE NOTICE 'No agents found — all chats will be assigned to the admin account.';
  ELSIF v_agent2_id IS NULL THEN
    v_agent2_id := v_agent1_id;  -- only one agent exists
    RAISE NOTICE 'Only one agent found — agent2 slots will use the same agent.';
  END IF;

  -- ── Resolve survey + question IDs ──────────────────────────────────────────
  SELECT id INTO v_survey_id FROM surveys WHERE is_default = true LIMIT 1;
  IF v_survey_id IS NULL THEN
    RAISE EXCEPTION 'Default survey not found. Start the app at least once so the survey tables are created and seeded.';
  END IF;

  SELECT id INTO v_q_rating
    FROM survey_questions WHERE survey_id = v_survey_id AND question_type = 'rating'
    ORDER BY order_index LIMIT 1;

  SELECT id INTO v_q_yesno
    FROM survey_questions WHERE survey_id = v_survey_id AND question_type = 'yes_no'
    ORDER BY order_index LIMIT 1;

  SELECT id INTO v_q_text
    FROM survey_questions WHERE survey_id = v_survey_id AND question_type = 'free_text'
    ORDER BY order_index LIMIT 1;

  RAISE NOTICE 'Using: admin=%, agent1=%, agent2=%, survey=%',
    v_admin_id, v_agent1_id, v_agent2_id, v_survey_id;

  -- ══════════════════════════════════════════════════════════════════════════
  --  ESCALATIONS  (10 total)
  --  Status distribution: open(2)  in_progress(2)  closed(6)
  --  Date distribution for stats stress-testing:
  --    today      → e5 (agent1), e6 (agent2)           [resolved_today]
  --    this week  → e5, e6, e7 (agent1), e8 (agent2)   [resolved_this_week]
  --    this month → above + e9 (admin)                 [resolved_this_month]
  --    all time   → all 6 closed incl. e10 (agent1, 35 days ago)
  -- ══════════════════════════════════════════════════════════════════════════

  -- 1 ▸ Open · unassigned · Arabic speaker · payment issue (just now)
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110001', 'طلب التحدث مع موظف بشري — مشكلة في الدفع', 'open', NULL, NOW() - INTERVAL '45 minutes')
  RETURNING id INTO v_e1;

  -- 2 ▸ Open · unassigned · English · cancellation request
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110002', 'Customer requested human agent — subscription cancellation', 'open', NULL, NOW() - INTERVAL '2 hours')
  RETURNING id INTO v_e2;

  -- 3 ▸ In Progress · agent1 · English · billing discrepancy
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110003', 'Billing discrepancy — duplicate charge on invoice', 'in_progress', v_agent1_id, NOW() - INTERVAL '3 hours')
  RETURNING id INTO v_e3;

  -- 4 ▸ In Progress · agent2 · Arabic · appointment booking
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110004', 'استفسار عن حجز موعد — طلب التحدث مع موظف', 'in_progress', v_agent2_id, NOW() - INTERVAL '1 hour 30 minutes')
  RETURNING id INTO v_e4;

  -- 5 ▸ Closed · agent1 · today · account access — will have 5★ survey
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110005', 'Account access issue — password reset not working', 'closed', v_agent1_id, NOW() - INTERVAL '5 hours')
  RETURNING id INTO v_e5;

  -- 6 ▸ Closed · agent2 · today · Arabic cancellation — will have 4★ survey
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110006', 'طلب إلغاء الاشتراك بسبب السعر', 'closed', v_agent2_id, NOW() - INTERVAL '4 hours')
  RETURNING id INTO v_e6;

  -- 7 ▸ Closed · agent1 · 2 days ago · service outage complaint — will have 2★ survey
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110007', 'Service outage complaint — demanding escalation to manager', 'closed', v_agent1_id, NOW() - INTERVAL '2 days')
  RETURNING id INTO v_e7;

  -- 8 ▸ Closed · agent2 · 3 days ago · Arabic pricing enquiry — will have 5★ survey
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110008', 'استفسار عن باقات الأسعار للشركات', 'closed', v_agent2_id, NOW() - INTERVAL '3 days')
  RETURNING id INTO v_e8;

  -- 9 ▸ Closed · admin · 12 days ago · technical integration (in this month, not this week)
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110009', 'Technical support — Salesforce webhook integration setup', 'closed', v_admin_id, NOW() - INTERVAL '12 days')
  RETURNING id INTO v_e9;

  -- 10 ▸ Closed · agent1 · 35 days ago · Arabic billing (all time only)
  INSERT INTO escalations (customer_phone, escalation_reason, status, assigned_agent_id, created_at)
  VALUES ('+966501110010', 'مشكلة في الفاتورة الشهرية — رسوم غير متوقعة', 'closed', v_agent1_id, NOW() - INTERVAL '35 days')
  RETURNING id INTO v_e10;

  -- ══════════════════════════════════════════════════════════════════════════
  --  MESSAGES  (6–7 per chat, bilingual, realistic conversation arc)
  --  direction: customer→inbound, ai/agent→outbound
  -- ══════════════════════════════════════════════════════════════════════════

  -- ── Chat 1: Open · unassigned · Arabic · payment issue ────────────────────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110001', 'inbound',  'السلام عليكم، أحتاج مساعدة في طلبي. لم يتم تأكيد الدفع',             'customer', v_e1, NOW() - INTERVAL '50 minutes'),
    ('+966501110001', 'outbound', 'وعليكم السلام! أهلاً بك في WAK Solutions. سأساعدك الآن. ما رقم الطلب؟', 'ai',       v_e1, NOW() - INTERVAL '49 minutes'),
    ('+966501110001', 'inbound',  'رقم الطلب هو ORD-20491',                                               'customer', v_e1, NOW() - INTERVAL '48 minutes'),
    ('+966501110001', 'outbound', 'شكراً. أرى الطلب. هل تم خصم المبلغ من بطاقتك؟',                       'ai',       v_e1, NOW() - INTERVAL '47 minutes'),
    ('+966501110001', 'inbound',  'نعم، خُصم المبلغ لكن الطلب ما زال معلقاً. أريد التحدث مع موظف',        'customer', v_e1, NOW() - INTERVAL '46 minutes'),
    ('+966501110001', 'outbound', 'بالتأكيد، سأحولك الآن إلى أحد موظفينا. يرجى الانتظار لحظة.',           'ai',       v_e1, NOW() - INTERVAL '45 minutes');

  -- ── Chat 2: Open · unassigned · English · cancellation ───────────────────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110002', 'inbound',  'Hello, I need to cancel my subscription immediately',                    'customer', v_e2, NOW() - INTERVAL '2 hours 10 minutes'),
    ('+966501110002', 'outbound', 'Hi! I can help with that. Could you share the account email and reason for cancellation?', 'ai', v_e2, NOW() - INTERVAL '2 hours 9 minutes'),
    ('+966501110002', 'inbound',  'Email is client@company.sa — we are switching to an in-house solution',  'customer', v_e2, NOW() - INTERVAL '2 hours 7 minutes'),
    ('+966501110002', 'outbound', 'Understood. Before I process this, I would like to connect you with an account manager who may be able to offer an alternative.', 'ai', v_e2, NOW() - INTERVAL '2 hours 6 minutes'),
    ('+966501110002', 'inbound',  'OK but I want to speak to a real person, not a bot',                     'customer', v_e2, NOW() - INTERVAL '2 hours 4 minutes'),
    ('+966501110002', 'outbound', 'Of course — connecting you with a human agent now.',                     'ai',       v_e2, NOW() - INTERVAL '2 hours 3 minutes');

  -- ── Chat 3: In Progress · agent1 · English · billing dispute ─────────────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110003', 'inbound',  'I was charged twice this month. Order #INV-8812. This is completely unacceptable!', 'customer', v_e3, NOW() - INTERVAL '3 hours 30 minutes'),
    ('+966501110003', 'outbound', 'I sincerely apologize for this. Let me pull up your account right away.',           'ai',       v_e3, NOW() - INTERVAL '3 hours 29 minutes'),
    ('+966501110003', 'inbound',  'Please fix this today. I need the refund processed urgently',                       'customer', v_e3, NOW() - INTERVAL '3 hours 28 minutes'),
    ('+966501110003', 'outbound', 'Transferring you to our billing specialist now.',                                   'ai',       v_e3, NOW() - INTERVAL '3 hours 27 minutes'),
    ('+966501110003', 'outbound', 'Hi, I''m from the billing team. I can see the duplicate charge on INV-8812. I''m raising a refund request now — you''ll see it within 3–5 business days.', 'agent', v_e3, NOW() - INTERVAL '3 hours'),
    ('+966501110003', 'inbound',  'Thank you. Will I get a confirmation email?',                                       'customer', v_e3, NOW() - INTERVAL '2 hours 55 minutes'),
    ('+966501110003', 'outbound', 'Yes, a confirmation will be sent to your registered email within the hour.',        'agent',    v_e3, NOW() - INTERVAL '2 hours 50 minutes');

  -- ── Chat 4: In Progress · agent2 · Arabic · appointment booking ───────────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110004', 'inbound',  'مرحباً، أود حجز موعد لمناقشة خدمات الشركات',                                        'customer', v_e4, NOW() - INTERVAL '2 hours'),
    ('+966501110004', 'outbound', 'أهلاً وسهلاً! يسعدنا ترتيب ذلك. هل لديك تفضيل لأيام معينة؟',                        'ai',       v_e4, NOW() - INTERVAL '1 hour 59 minutes'),
    ('+966501110004', 'inbound',  'أفضل بداية الأسبوع القادم، في الصباح إن أمكن',                                       'customer', v_e4, NOW() - INTERVAL '1 hour 58 minutes'),
    ('+966501110004', 'outbound', 'ممتاز! سأوصلك بمدير الحسابات ليؤكد الموعد المتاح.',                                  'ai',       v_e4, NOW() - INTERVAL '1 hour 57 minutes'),
    ('+966501110004', 'outbound', 'مرحباً! أنا أحمد من فريق المبيعات. لدينا مواعيد متاحة الأحد الساعة 10 أو الاثنين الساعة 11. أيهما أنسب؟', 'agent', v_e4, NOW() - INTERVAL '1 hour 20 minutes'),
    ('+966501110004', 'inbound',  'الأحد الساعة العاشرة صباحاً يناسبني',                                                'customer', v_e4, NOW() - INTERVAL '1 hour 10 minutes'),
    ('+966501110004', 'outbound', 'تم تأكيد الموعد. ستصلك رسالة تأكيد مع رابط الاجتماع قريباً.',                       'agent',    v_e4, NOW() - INTERVAL '1 hour');

  -- ── Chat 5: Closed · agent1 · today · account access ─────────────────────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110005', 'inbound',  'I cannot log in to my account. Password reset link is not working',     'customer', v_e5, NOW() - INTERVAL '6 hours'),
    ('+966501110005', 'outbound', 'I''m sorry to hear that. I''ll escalate this to our access team now.', 'ai',       v_e5, NOW() - INTERVAL '5 hours 59 minutes'),
    ('+966501110005', 'outbound', 'Hi! I''ve manually reset your account. Please check your email for a temporary password — it expires in 30 minutes.', 'agent', v_e5, NOW() - INTERVAL '5 hours 30 minutes'),
    ('+966501110005', 'inbound',  'Got it, logging in now... it worked! You are a lifesaver, thank you!', 'customer', v_e5, NOW() - INTERVAL '5 hours 20 minutes'),
    ('+966501110005', 'outbound', 'Great to hear! Please change your password immediately after login for security.', 'agent', v_e5, NOW() - INTERVAL '5 hours 15 minutes'),
    ('+966501110005', 'inbound',  'Done. Is there anything else I should do?',                             'customer', v_e5, NOW() - INTERVAL '5 hours 10 minutes'),
    ('+966501110005', 'outbound', 'You''re all set! Enable two-factor authentication from your account settings for extra security. Have a great day!', 'agent', v_e5, NOW() - INTERVAL '5 hours 5 minutes');

  -- ── Chat 6: Closed · agent2 · today · Arabic · cancellation retained ──────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110006', 'inbound',  'أريد إلغاء اشتراكي. السعر أصبح مرتفعاً جداً مقارنة بالمنافسين',                  'customer', v_e6, NOW() - INTERVAL '5 hours'),
    ('+966501110006', 'outbound', 'نأسف لسماع ذلك. هل يمكنني معرفة المنافس الذي تقصده حتى نتمكن من مساعدتك بشكل أفضل؟', 'ai', v_e6, NOW() - INTERVAL '4 hours 59 minutes'),
    ('+966501110006', 'inbound',  'شركة X تقدم نفس الخدمة بنصف السعر',                                               'customer', v_e6, NOW() - INTERVAL '4 hours 58 minutes'),
    ('+966501110006', 'outbound', 'شكراً لصراحتك. سأوصلك بمدير الحسابات لمناقشة خيارات مخصصة لك.',                   'ai',       v_e6, NOW() - INTERVAL '4 hours 57 minutes'),
    ('+966501110006', 'outbound', 'مرحباً! نقدر ولاءك. لدينا عرض حصري: خصم 30% لمدة 6 أشهر إذا جددت اشتراكك الآن. هل يهمك؟', 'agent', v_e6, NOW() - INTERVAL '4 hours 30 minutes'),
    ('+966501110006', 'inbound',  'هذا العرض جيد. سأقبله. شكراً',                                                     'customer', v_e6, NOW() - INTERVAL '4 hours 20 minutes'),
    ('+966501110006', 'outbound', 'ممتاز! تم تطبيق الخصم على حسابك. ستصلك رسالة تأكيد. نشكرك على استمرارك معنا.',    'agent',    v_e6, NOW() - INTERVAL '4 hours 10 minutes');

  -- ── Chat 7: Closed · agent1 · 2 days ago · English · outage complaint ─────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110007', 'inbound',  'Your platform has been DOWN for 2 hours!! This is costing my business real money!', 'customer', v_e7, NOW() - INTERVAL '2 days 3 hours'),
    ('+966501110007', 'outbound', 'I sincerely apologize. Our engineering team has identified the issue and is working on an urgent fix.', 'ai', v_e7, NOW() - INTERVAL '2 days 2 hours 59 minutes'),
    ('+966501110007', 'inbound',  'I need to speak to a MANAGER. This is not good enough',                             'customer', v_e7, NOW() - INTERVAL '2 days 2 hours 58 minutes'),
    ('+966501110007', 'outbound', 'Escalating to our team lead immediately.',                                          'ai',       v_e7, NOW() - INTERVAL '2 days 2 hours 57 minutes'),
    ('+966501110007', 'outbound', 'Hello, I''m the operations lead. The outage has been resolved as of 10 minutes ago. I''m personally applying a full 1-month service credit to your account.', 'agent', v_e7, NOW() - INTERVAL '2 days 2 hours'),
    ('+966501110007', 'inbound',  'Fine. But this cannot happen again. I expect a proper incident report.',            'customer', v_e7, NOW() - INTERVAL '2 days 1 hour 55 minutes'),
    ('+966501110007', 'outbound', 'Absolutely. I''ll have the incident report sent to your email by end of day. The credit is already applied.', 'agent', v_e7, NOW() - INTERVAL '2 days 1 hour 50 minutes');

  -- ── Chat 8: Closed · agent2 · 3 days ago · Arabic · enterprise pricing ────
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110008', 'inbound',  'ما هي باقاتكم للشركات؟ نحن شركة متوسطة الحجم نبحث عن حل مناسب',                  'customer', v_e8, NOW() - INTERVAL '3 days 3 hours'),
    ('+966501110008', 'outbound', 'أهلاً! لدينا باقات مخصصة للشركات. سأوصلك بفريق مبيعات الشركات للتفاصيل.',         'ai',       v_e8, NOW() - INTERVAL '3 days 2 hours 59 minutes'),
    ('+966501110008', 'inbound',  'نريد دعم 24/7 ومدير حساب مخصص',                                                    'customer', v_e8, NOW() - INTERVAL '3 days 2 hours 58 minutes'),
    ('+966501110008', 'outbound', 'فهمت احتياجاتكم. مدير المبيعات سيتواصل معك الآن.',                                 'ai',       v_e8, NOW() - INTERVAL '3 days 2 hours 57 minutes'),
    ('+966501110008', 'outbound', 'مرحباً! باقة الشركات تشمل: دعم 24/7، مدير حساب مخصص، SLA بنسبة 99.9%. السعر 999 ريال/شهر مع خصم 20% للاشتراك السنوي.', 'agent', v_e8, NOW() - INTERVAL '3 days 2 hours'),
    ('+966501110008', 'inbound',  'سنناقش الأمر مع الإدارة هذا الأسبوع ونعود إليكم',                                   'customer', v_e8, NOW() - INTERVAL '3 days 1 hour 55 minutes'),
    ('+966501110008', 'outbound', 'بالتأكيد! سأرسل لك عرضاً رسمياً على بريدك الإلكتروني. نحن هنا لأي استفسار.',       'agent',    v_e8, NOW() - INTERVAL '3 days 1 hour 50 minutes');

  -- ── Chat 9: Closed · admin · 12 days ago · English · technical integration ─
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110009', 'inbound',  'We need urgent help. Our Salesforce webhook integration stopped firing after your last update.', 'customer', v_e9, NOW() - INTERVAL '12 days 4 hours'),
    ('+966501110009', 'outbound', 'I understand the urgency. Let me escalate this to our technical integration team immediately.', 'ai', v_e9, NOW() - INTERVAL '12 days 3 hours 59 minutes'),
    ('+966501110009', 'inbound',  'We have been down for 4 hours. This is blocking our entire sales pipeline',          'customer', v_e9, NOW() - INTERVAL '12 days 3 hours 58 minutes'),
    ('+966501110009', 'outbound', 'Connecting you now to our senior integration engineer.',                             'ai',       v_e9, NOW() - INTERVAL '12 days 3 hours 57 minutes'),
    ('+966501110009', 'outbound', 'Hi, I''ve reviewed your Salesforce config. After last night''s update, the webhook endpoint now requires an ''X-WAK-Signature'' header. Here is the implementation guide: [link]. I can also join a screen share if needed.', 'agent', v_e9, NOW() - INTERVAL '12 days 3 hours'),
    ('+966501110009', 'inbound',  'That was it! Webhooks are firing correctly now. Really appreciate the fast turnaround.', 'customer', v_e9, NOW() - INTERVAL '12 days 2 hours'),
    ('+966501110009', 'outbound', 'Excellent! I''ve flagged this as a migration note for our next release. Let me know if anything else comes up.', 'agent', v_e9, NOW() - INTERVAL '12 days 1 hour 55 minutes');

  -- ── Chat 10: Closed · agent1 · 35 days ago · Arabic · billing clarification ─
  INSERT INTO messages (customer_phone, direction, message_text, sender, escalation_id, created_at) VALUES
    ('+966501110010', 'inbound',  'فاتورة هذا الشهر أعلى من المعتاد بمقدار 200 ريال. ما السبب؟',                      'customer', v_e10, NOW() - INTERVAL '35 days 3 hours'),
    ('+966501110010', 'outbound', 'نعتذر عن الإرباك. سأفحص تفاصيل فاتورتك الآن.',                                    'ai',        v_e10, NOW() - INTERVAL '35 days 2 hours 59 minutes'),
    ('+966501110010', 'inbound',  'أريد تفسيراً مفصلاً للرسوم الإضافية',                                              'customer', v_e10, NOW() - INTERVAL '35 days 2 hours 58 minutes'),
    ('+966501110010', 'outbound', 'سأحولك إلى قسم الفواتير للحصول على إجابة دقيقة.',                                  'ai',        v_e10, NOW() - INTERVAL '35 days 2 hours 57 minutes'),
    ('+966501110010', 'outbound', 'مرحباً! الرسوم الإضافية تعود إلى ترقية الباقة التي طلبتها في 15 الشهر الماضي. تُحسب الرسوم بالتناسب مع باقي الشهر.', 'agent', v_e10, NOW() - INTERVAL '35 days 2 hours'),
    ('+966501110010', 'inbound',  'آه، صحيح. نسيت الترقية. شكراً للتوضيح',                                            'customer', v_e10, NOW() - INTERVAL '35 days 1 hour 55 minutes'),
    ('+966501110010', 'outbound', 'بكل سرور! إذا احتجت أي مساعدة مستقبلاً فنحن هنا دائماً.',                          'agent',    v_e10, NOW() - INTERVAL '35 days 1 hour 50 minutes');

  -- ══════════════════════════════════════════════════════════════════════════
  --  MEETINGS  (4 total)
  --  completed(2)  in_progress(1)  pending(1)
  -- ══════════════════════════════════════════════════════════════════════════

  -- M1 ▸ Completed · agent1 · 7 days ago · linked to customer 5 (account access)
  INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, scheduled_at, status, agent_id, created_at)
  VALUES (
    '+966501110005',
    'https://wak-solutions.daily.co/seed-room-001',
    'seedmtk001',
    NOW() + INTERVAL '1 year',
    NOW() - INTERVAL '7 days',
    'completed',
    v_agent1_id,
    NOW() - INTERVAL '8 days'
  ) RETURNING id INTO v_m1;

  -- M2 ▸ Completed · agent2 · 3 days ago · linked to customer 8 (enterprise sales)
  INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, scheduled_at, status, agent_id, created_at)
  VALUES (
    '+966501110008',
    'https://wak-solutions.daily.co/seed-room-002',
    'seedmtk002',
    NOW() + INTERVAL '1 year',
    NOW() - INTERVAL '3 days',
    'completed',
    v_agent2_id,
    NOW() - INTERVAL '4 days'
  ) RETURNING id INTO v_m2;

  -- M3 ▸ In Progress · agent2 · started 20 min ago · linked to customer 4 (ongoing chat)
  INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, scheduled_at, status, agent_id, created_at)
  VALUES (
    '+966501110004',
    'https://wak-solutions.daily.co/seed-room-003',
    'seedmtk003',
    NOW() + INTERVAL '1 year',
    NOW() - INTERVAL '20 minutes',
    'in_progress',
    v_agent2_id,
    NOW() - INTERVAL '1 day'
  ) RETURNING id INTO v_m3;

  -- M4 ▸ Pending · unassigned · new customer · 3 days from now (appears in inbox as standalone)
  INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, scheduled_at, status, agent_id, created_at)
  VALUES (
    '+966501110011',
    'https://wak-solutions.daily.co/seed-room-004',
    'seedmtk004',
    NOW() + INTERVAL '1 year',
    NOW() + INTERVAL '3 days',
    'pending',
    NULL,
    NOW() - INTERVAL '2 hours'
  ) RETURNING id INTO v_m4;

  -- ══════════════════════════════════════════════════════════════════════════
  --  SURVEY RESPONSES + ANSWERS  (6 total)
  --
  --  Submitted: SR1(★5) SR2(★4) SR3(★2) SR4(★5) SR6(★4)  →  SR5 not submitted
  --
  --  Expected avg_survey_rating in Agents tab:
  --    agent1 : (5 + 2) / 2  = 3.5  → amber colour
  --    agent2 : (4 + 5 + 4) / 3 = 4.3  → green colour
  --    admin  : no ratings           → null
  -- ══════════════════════════════════════════════════════════════════════════

  -- SR1 ▸ agent1 · chat-close · customer5 · ★5 · English
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-001', '+966501110005', v_agent1_id, v_e5,
          true, NOW() - INTERVAL '4 hours 30 minutes', NOW() + INTERVAL '7 days', NOW() - INTERVAL '5 hours')
  RETURNING id INTO v_sr1;

  INSERT INTO survey_answers (response_id, question_id, answer_rating, answer_yes_no, answer_text) VALUES
    (v_sr1, v_q_rating, 5,    NULL,  NULL),
    (v_sr1, v_q_yesno,  NULL, true,  NULL),
    (v_sr1, v_q_text,   NULL, NULL,  'Excellent support. My issue was fixed in under 30 minutes. I would not hesitate to contact the team again.');

  -- SR2 ▸ agent2 · chat-close · customer6 · ★4 · Arabic
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-002', '+966501110006', v_agent2_id, v_e6,
          true, NOW() - INTERVAL '3 hours 30 minutes', NOW() + INTERVAL '7 days', NOW() - INTERVAL '4 hours')
  RETURNING id INTO v_sr2;

  INSERT INTO survey_answers (response_id, question_id, answer_rating, answer_yes_no, answer_text) VALUES
    (v_sr2, v_q_rating, 4,    NULL,  NULL),
    (v_sr2, v_q_yesno,  NULL, true,  NULL),
    (v_sr2, v_q_text,   NULL, NULL,  'الخدمة جيدة جداً والموظف كان متعاوناً وسريع الاستجابة. شكراً لكم.');

  -- SR3 ▸ agent1 · chat-close · customer7 · ★2 · English (unhappy — outage)
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-003', '+966501110007', v_agent1_id, v_e7,
          true, NOW() - INTERVAL '1 day 20 hours', NOW() + INTERVAL '7 days', NOW() - INTERVAL '2 days')
  RETURNING id INTO v_sr3;

  INSERT INTO survey_answers (response_id, question_id, answer_rating, answer_yes_no, answer_text) VALUES
    (v_sr3, v_q_rating, 2,    NULL,  NULL),
    (v_sr3, v_q_yesno,  NULL, false, NULL),
    (v_sr3, v_q_text,   NULL, NULL,  'The outage was completely unacceptable and cost us business. The credit helps but reliability must improve. Would not recommend at this stage.');

  -- SR4 ▸ agent2 · chat-close · customer8 · ★5 · Arabic
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, escalation_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-004', '+966501110008', v_agent2_id, v_e8,
          true, NOW() - INTERVAL '2 days 20 hours', NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 days')
  RETURNING id INTO v_sr4;

  INSERT INTO survey_answers (response_id, question_id, answer_rating, answer_yes_no, answer_text) VALUES
    (v_sr4, v_q_rating, 5,    NULL,  NULL),
    (v_sr4, v_q_yesno,  NULL, true,  NULL),
    (v_sr4, v_q_text,   NULL, NULL,  'الموظف شرح كل التفاصيل بوضوح وبصبر. من أفضل تجارب خدمة العملاء التي مررت بها. ممتاز!');

  -- SR5 ▸ agent1 · meeting-close · customer5 (meeting M1) · NOT submitted (link sent but ignored)
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, meeting_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-005', '+966501110005', v_agent1_id, v_m1,
          false, NULL, NOW() + INTERVAL '7 days', NOW() - INTERVAL '7 days')
  RETURNING id INTO v_sr5;
  -- No answers inserted (customer never clicked the link)

  -- SR6 ▸ agent2 · meeting-close · customer8 (meeting M2) · ★4 · English
  INSERT INTO survey_responses (survey_id, token, customer_phone, agent_id, meeting_id,
                                submitted, submitted_at, expires_at, created_at)
  VALUES (v_survey_id, 'seed-sr-006', '+966501110008', v_agent2_id, v_m2,
          true, NOW() - INTERVAL '2 days 18 hours', NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 days')
  RETURNING id INTO v_sr6;

  INSERT INTO survey_answers (response_id, question_id, answer_rating, answer_yes_no, answer_text) VALUES
    (v_sr6, v_q_rating, 4,    NULL,  NULL),
    (v_sr6, v_q_yesno,  NULL, true,  NULL),
    (v_sr6, v_q_text,   NULL, NULL,  'Good meeting, clear and informative. The agent knew the product well. Would have preferred a shorter wait to connect initially.');

  RAISE NOTICE '✓ Seed complete: 10 escalations, 10 chat threads (~68 messages), 4 meetings, 6 survey responses (5 submitted).';

END $$;

COMMIT;
