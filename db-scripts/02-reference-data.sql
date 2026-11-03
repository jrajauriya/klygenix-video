-- Reference data every database carries: GST codes with dated rates and the plans.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10 (Debian 17.10-1.pgdg12+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: plans; Type: TABLE DATA; Schema: kv_commerce; Owner: -
--

COPY kv_commerce.plans (id, key, audience, name, description, price_inr_minor, price_usd_minor, limits, is_active, sort) FROM stdin;
1	viewer_free	viewer	Free	Watch everything; summaries, chapters and subtitles; 5 Ask questions a day.	0	0	{"languages": 2, "ask_per_day": 5}	t	10
2	viewer_premium	viewer	Viewer Premium	Ask without the daily limit, notes, every subtitle language.	14900	499	{"notes": true, "languages": 6, "ask_per_day": 200}	t	20
3	creator_free	creator	Creator Free	Upload and publish; 60 AI minutes and 3 clip renders a month.	0	0	{"seats": 1, "renders": 3, "watermark": true, "ai_minutes": 60}	t	30
4	creator_pro	creator	Creator Pro	600 AI minutes, unlimited clips within fair use, no watermark, analytics.	49900	999	{"seats": 1, "renders": 500, "watermark": false, "ai_minutes": 600}	t	40
5	creator_business	creator	Creator Business	3,000 AI minutes, 5 seats, brand kit, priority renders.	199900	3999	{"seats": 5, "renders": 3000, "priority": true, "watermark": false, "ai_minutes": 3000}	t	50
\.


--
-- Data for Name: tax_codes; Type: TABLE DATA; Schema: kv_tax; Owner: -
--

COPY kv_tax.tax_codes (id, code, name, sac) FROM stdin;
1	OIDAR	Online information and digital content	998431
2	SAAS	Software as a service — creator tools	997331
3	NONE	No GST — tips, outside scope	999799
\.


--
-- Data for Name: tax_rates; Type: TABLE DATA; Schema: kv_tax; Owner: -
--

COPY kv_tax.tax_rates (id, tax_code_id, rate_bps, effective_from, effective_to, source) FROM stdin;
1	1	1800	2017-07-01	\N	Believed current Nov 2026 — confirm with CA before launch
2	2	1800	2017-07-01	\N	Believed current Nov 2026 — confirm with CA before launch
3	3	0	2017-07-01	\N	Believed current Nov 2026 — confirm with CA before launch
\.


--
-- Data for Name: withholding_rates; Type: TABLE DATA; Schema: kv_tax; Owner: -
--

COPY kv_tax.withholding_rates (id, section, rate_bps, threshold_minor, effective_from, source) FROM stdin;
\.


--
-- Name: plans_id_seq; Type: SEQUENCE SET; Schema: kv_commerce; Owner: -
--

SELECT pg_catalog.setval('kv_commerce.plans_id_seq', 5, true);


--
-- Name: tax_codes_id_seq; Type: SEQUENCE SET; Schema: kv_tax; Owner: -
--

SELECT pg_catalog.setval('kv_tax.tax_codes_id_seq', 3, true);


--
-- Name: tax_rates_id_seq; Type: SEQUENCE SET; Schema: kv_tax; Owner: -
--

SELECT pg_catalog.setval('kv_tax.tax_rates_id_seq', 3, true);


--
-- Name: withholding_rates_id_seq; Type: SEQUENCE SET; Schema: kv_tax; Owner: -
--

SELECT pg_catalog.setval('kv_tax.withholding_rates_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--


