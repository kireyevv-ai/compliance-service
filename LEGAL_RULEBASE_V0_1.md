# LEGAL_RULEBASE_V0_1.md

## Legal Rulebase v0.1 — рабочий юридический слой MVP

**Версия:** 0.1-draft  
**Дата сверки:** 6 сентября 2026  
**Количество правил:** 50  
**Статус:** рабочий набор до экспертного юридического ревью

### Зачем этот документ

Это не юридический чек-лист «чем больше красных пунктов, тем лучше». Правило включается только если оно даёт полезный, объяснимый и проверяемый результат.

### Legal strength

- `MANDATORY` — правило опирается на обязательную норму.
- `REGULATOR_RECOMMENDATION` — основано на рекомендациях/руководстве регулятора; не показывать как безусловное нарушение.
- `RISK_SIGNAL` — технический факт сам по себе не доказывает нарушение, но требует проверки.

### Статусы

- `FAIL` — при указанных условиях автоматического evidence достаточно для вывода по конкретному правилу.
- `WARNING` — есть значимый риск/несоответствие, но вывод требует осторожной формулировки.
- `MANUAL_CHECK` — необходимых юридических/бизнес-фактов нет в публичной части сайта.

### Критический запрет

**Foreign server / foreign script / foreign endpoint ≠ автоматически нарушение локализации или трансграничной передачи.**


## Правила

### 1. `PD-001` — Политика обработки ПД не найдена на сайте, который собирает ПД

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** personal_data_collection_found; privacy_policy_found=false
- **required_evidence:** URL формы + DOM формы + результат поиска политики
- **legal_basis:** 152-ФЗ, ст. 18.1 ч. 2
- **remediation:** Опубликовать политику и обеспечить к ней неограниченный доступ.


### 2. `PD-002` — Ссылка на политику обработки ПД недоступна или ведёт на ошибку

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_link_found=true; policy_url_accessible=false
- **required_evidence:** URL страницы + href + HTTP/browser result
- **legal_basis:** 152-ФЗ, ст. 18.1 ч. 2
- **remediation:** Исправить ссылку/доступность документа.


### 3. `PD-003` — На странице сбора ПД нет доступного пути к политике

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** personal_data_collection_found=true; policy_access_from_collection_page=false
- **required_evidence:** URL формы + DOM вокруг формы/футера
- **legal_basis:** 152-ФЗ, ст. 18.1 ч. 2
- **remediation:** Добавить доступ к политике на странице, где собираются ПД.


### 4. `PD-004` — Политика доступна только после авторизации/ограничения доступа

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_found=true; unrestricted_access=false
- **required_evidence:** URL политики + browser state
- **legal_basis:** 152-ФЗ, ст. 18.1 ч. 2
- **remediation:** Обеспечить неограниченный доступ к политике.


### 5. `PD-005` — Согласие на ПД объединено в одном подтверждении с офертой/условиями/иным документом

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** consent_control_found=true; combined_confirmation_with_other_documents=true
- **required_evidence:** DOM checkbox/button + связанный текст + ссылки
- **legal_basis:** 152-ФЗ, ст. 9 ч. 1 (ред. с 01.09.2025)
- **remediation:** Разделить подтверждение согласия на ПД и подтверждение иных документов.


### 6. `PD-006` — Контроль согласия на обработку ПД заранее активирован

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** pd_consent_control_found=true; control_prechecked=true
- **required_evidence:** DOM input/state + screenshot при необходимости
- **legal_basis:** 152-ФЗ, ст. 9 ч. 1
- **remediation:** Сделать согласие результатом явного действия пользователя; убрать предустановленное состояние.


### 7. `PD-007` — Форма собирает ПД, но автоматический аудит не установил основание обработки/механизм согласия

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** personal_data_collection_found=true; consent_mechanism_not_found=true; alternative_legal_basis_unknown=true
- **required_evidence:** DOM формы + связанный текст
- **legal_basis:** 152-ФЗ, ст. 6; ст. 9
- **remediation:** Уточнить правовое основание у владельца. Не объявлять отсутствие checkbox нарушением автоматически.


### 8. `PD-008` — Формулировка согласия не раскрывает понятную конкретную цель обработки

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** consent_text_found=true; clear_processing_purpose_detected=false
- **required_evidence:** Текст согласия
- **legal_basis:** 152-ФЗ, ст. 9 ч. 1
- **remediation:** Сделать согласие конкретным, предметным и информированным; явно описать цель.


### 9. `PD-009` — В согласии используются чрезмерно широкие формулировки «любые данные / любые цели»

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** consent_text_found=true; blanket_scope_detected=true
- **required_evidence:** Текст согласия
- **legal_basis:** 152-ФЗ, ст. 9 ч. 1
- **remediation:** Сузить цели и объём согласия до реально необходимых.


### 10. `PD-010` — Согласие на маркетинговые контакты объединено с основным обращением/заказом

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** service_form_found=true; marketing_consent_bundled=true
- **required_evidence:** DOM формы + текст согласия
- **legal_basis:** 152-ФЗ, ст. 15; 38-ФЗ, ст. 18
- **remediation:** Получать отдельное предварительное согласие на рекламные/маркетинговые сообщения.


### 11. `PD-011` — Согласие на маркетинговые сообщения заранее отмечено

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** marketing_consent_control_found=true; control_prechecked=true
- **required_evidence:** DOM input/state
- **legal_basis:** 152-ФЗ, ст. 15; 38-ФЗ, ст. 18
- **remediation:** Убрать предустановленное согласие; пользователь должен выразить его сам.


### 12. `PD-012` — Сайт планирует прямой маркетинг по e-mail/телефону, но доказательство предварительного согласия не установлено

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** direct_marketing_intent_detected=true; prior_consent_proof_unknown=true
- **required_evidence:** Форма подписки/маркетинговый текст
- **legal_basis:** 152-ФЗ, ст. 15; 38-ФЗ, ст. 18
- **remediation:** Проверить, как фиксируется предварительное согласие и можно ли доказать его получение.


### 13. `PD-013` — В политике не обнаружены цели обработки ПД

- **module:** `PERSONAL_DATA`
- **legal_strength:** `REGULATOR_RECOMMENDATION`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_found=true; policy_purposes_detected=false
- **required_evidence:** Фрагменты политики
- **legal_basis:** Рекомендации Роскомнадзора по составлению политики
- **remediation:** Добавить конкретные цели обработки, соответствующие бизнес-процессам.


### 14. `PD-014` — В политике не обнаружены категории/перечень обрабатываемых ПД

- **module:** `PERSONAL_DATA`
- **legal_strength:** `REGULATOR_RECOMMENDATION`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_found=true; policy_data_categories_detected=false
- **required_evidence:** Фрагменты политики
- **legal_basis:** Рекомендации Роскомнадзора по составлению политики
- **remediation:** Указать категории субъектов и обрабатываемых ПД по целям.


### 15. `PD-015` — В политике не обнаружены сроки/условия хранения и порядок уничтожения ПД

- **module:** `PERSONAL_DATA`
- **legal_strength:** `REGULATOR_RECOMMENDATION`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_found=true; retention_or_deletion_rules_detected=false
- **required_evidence:** Фрагменты политики
- **legal_basis:** 152-ФЗ, ст. 18.1 ч. 1 п. 2; рекомендации Роскомнадзора
- **remediation:** Описать сроки/условия обработки, хранения и порядок уничтожения.


### 16. `PD-016` — В политике не обнаружен понятный порядок обращения субъекта ПД

- **module:** `PERSONAL_DATA`
- **legal_strength:** `REGULATOR_RECOMMENDATION`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** privacy_policy_found=true; subject_request_procedure_detected=false
- **required_evidence:** Фрагменты политики
- **legal_basis:** 152-ФЗ, ст. 14; рекомендации Роскомнадзора
- **remediation:** Добавить порядок реализации прав субъекта и канал для обращений.


### 17. `PD-017` — Фактические поля формы не отражены в описании обрабатываемых данных в политике

- **module:** `PERSONAL_DATA`
- **legal_strength:** `RISK_SIGNAL`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** policy_parsed=true; collected_fields_not_covered_by_policy=true
- **required_evidence:** DOM формы + соответствующие фрагменты политики
- **legal_basis:** 152-ФЗ, ст. 5; ст. 18.1; рекомендации Роскомнадзора
- **remediation:** Сверить фактический сбор с политикой и актуализировать документ/форму.


### 18. `PD-018` — Внешний сервис участвует в работе сайта, но не обнаружен в описании обработки/политике

- **module:** `PERSONAL_DATA`
- **legal_strength:** `RISK_SIGNAL`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** external_service_detected=true; service_not_reflected_in_policy=true
- **required_evidence:** Network/script evidence + фрагменты политики
- **legal_basis:** 152-ФЗ, ст. 14 ч. 7; ст. 18.1
- **remediation:** Уточнить роль сервиса и при необходимости отразить получателя/обработчика и обработку в документах.


### 19. `PD-019` — Политика заявляет отсутствие передачи третьим лицам, но браузер фиксирует сторонние сервисы

- **module:** `PERSONAL_DATA`
- **legal_strength:** `RISK_SIGNAL`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** policy_no_third_party_transfer_claim=true; third_party_service_detected=true
- **required_evidence:** Фрагмент политики + network/script evidence
- **legal_basis:** 152-ФЗ, ст. 6; ст. 14; ст. 18.1
- **remediation:** Проверить фактический data flow и устранить противоречие между документом и сайтом.


### 20. `PD-020` — На странице сбора ПД обнаружен иностранный внешний сервис/endpoint

- **module:** `PERSONAL_DATA`
- **legal_strength:** `RISK_SIGNAL`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** personal_data_collection_found=true; foreign_service_or_endpoint_detected=true
- **required_evidence:** Network/script/iframe evidence
- **legal_basis:** 152-ФЗ, ст. 12; ст. 18 ч. 5
- **remediation:** Установить, какие данные реально передаются, кому и на каком основании. Сам иностранный endpoint не считать доказанным нарушением.


### 21. `PD-021` — Форма технически настроена на отправку данных на иностранный домен

- **module:** `PERSONAL_DATA`
- **legal_strength:** `RISK_SIGNAL`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** form_action_or_config_foreign_domain=true
- **required_evidence:** DOM form action / JS config
- **legal_basis:** 152-ФЗ, ст. 12; ст. 18 ч. 5
- **remediation:** Проверить реальный маршрут данных и условия трансграничной передачи/локализации.


### 22. `PD-022` — Местонахождение первичной базы ПД нельзя подтвердить по публичному сайту

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** personal_data_collection_found=true; database_location_unknown=true
- **required_evidence:** Технический аудит + отсутствие доказательств о БД
- **legal_basis:** 152-ФЗ, ст. 18 ч. 5
- **remediation:** Задать владельцу вопрос о месте первичной записи/хранения базы. Не делать вывод по геолокации web-сервера.


### 23. `PD-023` — Оператор, собирающий ПД автоматически, не найден в публичном реестре Роскомнадзора

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** operator_identified_confidently=true; automated_pd_processing=true; rkn_registry_match=false
- **required_evidence:** Идентификаторы оператора + результат реестра
- **legal_basis:** 152-ФЗ, ст. 22
- **remediation:** Проверить обязанность уведомления и корректность реквизитов поиска; при необходимости подать/актуализировать уведомление.


### 24. `PD-024` — Форма запрашивает специальные категории ПД или данные, похожие на них

- **module:** `PERSONAL_DATA`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** special_category_field_or_context_detected=true
- **required_evidence:** Названия полей/контекст формы
- **legal_basis:** 152-ФЗ, ст. 10
- **remediation:** Требуется отдельная проверка основания и режима обработки специальных категорий ПД.


### 25. `EC-001` — Для дистанционной продажи не обнаружена доступная оферта

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** site_type=ECOMMERCE; remote_sale_detected=true; offer_found=false
- **required_evidence:** Навигация/checkout/product pages
- **legal_basis:** Постановление Правительства РФ №657 от 30.05.2026, п. 20
- **remediation:** Разместить на сайте доступную оферту для дистанционной продажи.


### 26. `EC-002` — Ссылка на оферту недоступна или ведёт на ошибку

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** offer_link_found=true; offer_accessible=false
- **required_evidence:** URL + HTTP/browser result
- **legal_basis:** Постановление Правительства РФ №657, п. 20
- **remediation:** Исправить ссылку/доступность оферты.


### 27. `EC-003` — У российского юрлица-продавца не обнаружено полное наименование

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** site_type=ECOMMERCE; seller_kind=LEGAL_ENTITY; legal_name_found=false
- **required_evidence:** Страница реквизитов/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать полное фирменное наименование продавца.


### 28. `EC-004` — У российского юрлица-продавца не обнаружен ОГРН

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=LEGAL_ENTITY; ogrn_found=false
- **required_evidence:** Страница реквизитов/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать ОГРН.


### 29. `EC-005` — У российского юрлица-продавца не обнаружены адрес и место нахождения

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=LEGAL_ENTITY; seller_address_found=false
- **required_evidence:** Страница реквизитов/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать адрес и место нахождения.


### 30. `EC-006` — У российского юрлица-продавца не обнаружены ни e-mail, ни телефон

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=LEGAL_ENTITY; seller_email_found=false; seller_phone_found=false
- **required_evidence:** Контакты/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать e-mail и/или номер телефона.


### 31. `EC-007` — У продавца-ИП не обнаружены ФИО

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=INDIVIDUAL_ENTREPRENEUR; seller_fio_found=false
- **required_evidence:** Реквизиты/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать фамилию, имя, отчество (при наличии).


### 32. `EC-008` — У продавца-ИП не обнаружен ОГРНИП

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=INDIVIDUAL_ENTREPRENEUR; ogrnip_found=false
- **required_evidence:** Реквизиты/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать ОГРНИП.


### 33. `EC-009` — У продавца-ИП не обнаружены ни e-mail, ни телефон

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** seller_kind=INDIVIDUAL_ENTREPRENEUR; seller_email_found=false; seller_phone_found=false
- **required_evidence:** Контакты/оферта/футер
- **legal_basis:** Постановление Правительства РФ №657, п. 22
- **remediation:** Указать e-mail и/или номер телефона.


### 34. `EC-010` — Не обнаружена информация о форме/способах направления претензий

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** site_type=ECOMMERCE; complaint_submission_info_found=false
- **required_evidence:** Оферта/возврат/контакты/FAQ
- **legal_basis:** Постановление Правительства РФ №657, п. 24
- **remediation:** Разместить информацию о форме и способах направления претензий.


### 35. `EC-011` — Платная дополнительная услуга/товар заранее выбрана в checkout

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** paid_addon_detected=true; addon_preselected=true
- **required_evidence:** DOM/control state + price evidence
- **legal_basis:** ЗоЗПП, ст. 16 п. 3.1 (с 01.09.2025)
- **remediation:** Убрать автоматическую отметку; дополнительная покупка — только по явному согласию.


### 36. `EC-012` — Покупка основной позиции обусловлена обязательным приобретением платной дополнительной услуги

- **module:** `ECOMMERCE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** paid_addon_detected=true; addon_required_for_primary_purchase=true
- **required_evidence:** Checkout UI/условия
- **legal_basis:** ЗоЗПП, ст. 16 п. 3.1
- **remediation:** Сделать платную дополнительную услугу добровольной, если обязательность прямо не установлена законом.


### 37. `EC-013` — Цена товара/услуги для потребителя указана без цены в рублях

- **module:** `CONSUMER`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** consumer_offer_detected=true; price_found=true; ruble_price_found=false
- **required_evidence:** Цена на странице товара/услуги
- **legal_basis:** ЗоЗПП, ст. 10 п. 2
- **remediation:** Указать цену в рублях и условия приобретения.


### 38. `ADV-001` — Высокоуверенно распознанная интернет-реклама не содержит пометку «реклама»

- **module:** `ADVERTISING`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** internet_ad_confirmed=true; ad_label_found=false
- **required_evidence:** DOM/screenshot рекламного блока
- **legal_basis:** 38-ФЗ, ст. 18.1 ч. 16
- **remediation:** Добавить пометку «реклама».


### 39. `ADV-002` — Интернет-реклама не содержит идентифицируемого рекламодателя или ссылку на информацию о нём

- **module:** `ADVERTISING`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** internet_ad_confirmed=true; advertiser_identity_or_link_found=false
- **required_evidence:** DOM/screenshot рекламного блока
- **legal_basis:** 38-ФЗ, ст. 18.1 ч. 16
- **remediation:** Указать рекламодателя или ссылку на страницу с информацией о нём.


### 40. `ADV-003` — Для интернет-рекламы не обнаружен идентификатор рекламы (ERID), но применимость требует подтверждения

- **module:** `ADVERTISING`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** internet_ad_confirmed=true; erid_detected=false
- **required_evidence:** DOM/URL/query/markup evidence
- **legal_basis:** 38-ФЗ, ст. 18.1 ч. 17
- **remediation:** Проверить применимость требований маркировки к конкретному материалу и наличие присвоенного идентификатора.


### 41. `ADV-004` — Форма/механизм подписки предполагает рекламные сообщения, но способ доказать предварительное согласие не установлен

- **module:** `ADVERTISING`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** marketing_subscription_detected=true; consent_proof_mechanism_unknown=true
- **required_evidence:** DOM формы/текст подписки
- **legal_basis:** 38-ФЗ, ст. 18; 152-ФЗ, ст. 15
- **remediation:** Проверить, как фиксируется согласие адресата и можно ли связать его с конкретным рекламораспространителем.


### 42. `AUTH-001` — Российский владелец ресурса предоставляет доступ после авторизации, но не обнаружен ни один очевидно допустимый способ авторизации

- **module:** `AUTHORIZATION`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** owner_is_russian_confirmed=true; auth_required=true; allowed_auth_method_detected=false
- **required_evidence:** Login UI + провайдеры авторизации
- **legal_basis:** 149-ФЗ, ст. 8 ч. 10
- **remediation:** Проверить фактический способ авторизации пользователей из РФ и соответствие одному из предусмотренных законом способов.


### 43. `REC-001` — Есть признаки рекомендательных технологий, но не обнаружено уведомление об их применении

- **module:** `RECOMMENDATIONS`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `MANUAL_CHECK`
- **activation:** `MVP`
- **condition / facts:** recommendation_technology_suspected=true; recommendation_notice_found=false
- **required_evidence:** UI/скрипты/тексты персонализации
- **legal_basis:** 149-ФЗ, ст. 10.2-2 ч. 1 п. 2
- **remediation:** Подтвердить наличие рекомендательных технологий; если они применяются — разместить требуемое информирование.


### 44. `REC-002` — При подтверждённых рекомендательных технологиях не обнаружен документ с правилами их применения

- **module:** `RECOMMENDATIONS`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** recommendation_technology_confirmed=true; recommendation_rules_document_found=false
- **required_evidence:** Навигация/поиск документа
- **legal_basis:** 149-ФЗ, ст. 10.2-2 ч. 1 п. 3
- **remediation:** Разместить документ, устанавливающий правила применения рекомендательных технологий.


### 45. `REC-003` — Правила рекомендательных технологий недоступны свободно или не на русском языке

- **module:** `RECOMMENDATIONS`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** recommendation_rules_document_found=true; unrestricted_access=false OR russian_language=false
- **required_evidence:** URL документа + browser/text evidence
- **legal_basis:** 149-ФЗ, ст. 10.2-2 ч. 3
- **remediation:** Обеспечить беспрепятственный бесплатный доступ и русскоязычную версию.


### 46. `REC-004` — При подтверждённых рекомендательных технологиях не обнаружены e-mail для юридически значимых сообщений и сведения о владельце

- **module:** `RECOMMENDATIONS`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** recommendation_technology_confirmed=true; owner_contact_for_recommender_requirements_missing=true
- **required_evidence:** Страница правил/контакты
- **legal_basis:** 149-ФЗ, ст. 10.2-2 ч. 1 п. 4
- **remediation:** Разместить e-mail и сведения о владельце, предусмотренные законом.




### 47. `CON-001` — На B2C-сайте не обнаружены базовые сведения об организации-исполнителе/продавце

- **module:** `CONSUMER`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** site_type=B2C_SERVICE; seller_kind=LEGAL_ENTITY; legal_name_or_address_or_working_hours_missing=true
- **required_evidence:** Контакты/футер/условия/страница об организации
- **legal_basis:** ЗоЗПП, ст. 9
- **remediation:** Проверить способ доведения обязательных сведений потребителю и разместить на сайте наименование, адрес и режим работы, если сайт является основным каналом заключения/исполнения договора.

### 48. `CON-002` — На B2C-сайте ИП не обнаружена информация о государственной регистрации

- **module:** `CONSUMER`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** site_type=B2C_SERVICE; seller_kind=INDIVIDUAL_ENTREPRENEUR; ip_registration_info_found=false
- **required_evidence:** Контакты/футер/условия/страница об исполнителе
- **legal_basis:** ЗоЗПП, ст. 9
- **remediation:** Проверить способ доведения информации потребителю и разместить сведения о государственной регистрации ИП и зарегистрировавшем органе, если сайт является соответствующим каналом обслуживания.

### 49. `LANG-001` — Обязательная информация о продавце/товаре/услуге для потребителя представлена только не на русском языке

- **module:** `CONSUMER_LANGUAGE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `FAIL`
- **activation:** `MVP`
- **condition / facts:** consumer_mandatory_information_confirmed=true; russian_equivalent_found=false
- **required_evidence:** Фрагмент обязательной информации + классификация её как информации по ст. 8–10 ЗоЗПП
- **legal_basis:** ЗоЗПП, ст. 8–10
- **remediation:** Предоставить обязательную информацию для потребителя на русском языке. Дополнительные языки допустимы наряду с русским.

### 50. `LANG-002` — Публичная потребительская информация представлена только на иностранном языке

- **module:** `CONSUMER_LANGUAGE`
- **legal_strength:** `MANDATORY`
- **default_status_when_condition_met:** `WARNING`
- **activation:** `MVP`
- **condition / facts:** site_type in [B2C_SERVICE, ECOMMERCE]; public_non_ad_consumer_info_foreign_only=true; trademark_or_other_exception_unknown=true
- **required_evidence:** Фрагмент текста + контекст размещения
- **legal_basis:** ЗоЗПП, ст. 10.1 (действует с 01.03.2026)
- **remediation:** Проверить применимость исключений (фирменное наименование, товарный знак, знак обслуживания и др.). Если исключения нет — добавить русскоязычный вариант; иностранный язык может использоваться дополнительно.


## Правила, которые сознательно НЕ добавлены как автоматический FAIL

1. **«Сайт/сервер находится за границей»** — этого недостаточно для вывода о нарушении локализации ПД.
2. **«На сайте есть иностранный скрипт»** — этого недостаточно для доказательства трансграничной передачи персональных данных.
3. **«У формы нет checkbox»** — само по себе не доказывает нарушение: обработка может иметь другое правовое основание, а согласие законом не всегда привязано к конкретному UI-контролу.
4. **«Политика не соответствует рекомендованной структуре Роскомнадзора»** — рекомендации не превращаем в обязательную норму.
5. **«Любой английский текст на сайте запрещён»** — неверно; языковые требования имеют область применения и исключения.
6. **«Любой блок с товаром — интернет-реклама и обязан иметь ERID»** — квалификация рекламы и применимость маркировки требуют отдельной проверки.

## Что требуется от scanner для этой Rulebase

Минимальные группы Facts:

- наличие и тип форм;
- поля форм и обязательность;
- consent controls + default state;
- связанные с формой тексты/ссылки;
- policy/offer URLs и доступность;
- извлечённые реквизиты продавца;
- cookies/storage;
- network domains;
- scripts/iframes;
- form action / явные submit endpoints без отправки формы;
- external service identification;
- login/auth providers;
- признаки рекомендательных технологий;
- признаки рекламного блока с confidence;
- результаты поиска оператора в реестре РКН, когда оператор надёжно идентифицирован.

## Следующий юридический шаг

Перед тем как эти правила станут коммерческими `ACTIVE`:

1. проверить каждый `FAIL` профильным юристом;
2. создать golden cases PASS/FAIL/WARNING/MANUAL_CHECK;
3. перевести утверждённые правила в versioned YAML;
4. правила, которые scanner пока не умеет обеспечивать Facts/Evidence, оставить выключенными, а не имитировать их через LLM.


## Реестр правовых источников

Проверено по состоянию на 6 сентября 2026 года.

1. **152-ФЗ, ст. 9 — согласие на обработку ПД**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/6c94959bc017ac80140621762d2ac59f6006b08c/

2. **152-ФЗ, ст. 12 — трансграничная передача**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/e4ebbe1780de623c7cf32a59ca82a7bb523a25dd/

3. **152-ФЗ, ст. 14 — право субъекта на информацию**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/34585db685164ddd73440bf08348903bff6715aa/

4. **152-ФЗ, ст. 15 — прямой маркетинг**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/5656527e0713bf229a6932ac7084dec50d0ebe1f/

5. **152-ФЗ, ст. 18 — обязанности при сборе, локализация**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/

6. **152-ФЗ, ст. 18.1 — политика и меры оператора**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/eeeebe22bf738fd65bb66b95cc278911ae2525ee/

7. **152-ФЗ, ст. 22 — уведомление Роскомнадзора**  
   https://www.consultant.ru/document/cons_doc_LAW_61801/d996966e22e1320c9de1ab82d9f6be12c3d9d765/

8. **Рекомендации Роскомнадзора по составлению политики**  
   https://www.consultant.ru/document/cons_doc_LAW_221615/

9. **Рекомендации Роскомнадзора операторам ПД от 08.08.2023**  
   https://www.consultant.ru/document/cons_doc_LAW_454689/

10. **Постановление Правительства РФ №657 от 30.05.2026 — дистанционная продажа**  
    https://www.consultant.ru/document/cons_doc_LAW_535649/5d9db629bd7904808c6c40162d9a98583fe3e3d2/

11. **ЗоЗПП, ст. 10 — информация о товарах/услугах**  
    https://www.consultant.ru/document/cons_doc_LAW_305/e96b1cbe2a0795305a08c97b1a7f34ddab4ae908/

12. **ЗоЗПП, ст. 16 — дополнительные товары/работы/услуги**  
    https://www.consultant.ru/document/cons_doc_LAW_305/9eb0f127ead4dc57e7d0a9d4954cf264c4b3cea8/

13. **38-ФЗ, ст. 18 — реклама по сетям электросвязи**  
    https://www.consultant.ru/document/cons_doc_LAW_58968/f892dec1383709792452f18d36e7043306e2be0a/

14. **38-ФЗ, ст. 18.1 — интернет-реклама**  
    https://www.consultant.ru/document/cons_doc_LAW_58968/2c4537e4796f6ff8b2736ed1b0d4fef08e14458e/

15. **149-ФЗ, ст. 8 ч. 10 — способы авторизации**  
    https://www.consultant.ru/document/cons_doc_LAW_61798/78b773a28f3ad19eb234697b20ab1d48c09f748a/

16. **149-ФЗ, ст. 10.2-2 — рекомендательные технологии**  
    https://www.consultant.ru/document/cons_doc_LAW_61798/2a69c627d62738291fe0a0fd4c1253385e730784/

17. **152-ФЗ, ст. 10.1 — ПД, разрешённые для распространения**  
    https://www.consultant.ru/document/cons_doc_LAW_61801/591acc70f577873c1ee54765eda110b7a0271eaf/

### Важное ограничение

Источники 8–9 являются **рекомендациями регулятора**, а не самостоятельными нормами закона. Правила, основанные преимущественно на них, помечены `REGULATOR_RECOMMENDATION` и не должны автоматически выводиться пользователю как доказанное нарушение закона.
