\restrict dbmate

-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: adoptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adoptions (
    id bigint NOT NULL,
    tree_id bigint NOT NULL,
    user_id bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    paid_amount integer DEFAULT 0 NOT NULL,
    discount_amount integer DEFAULT 0 NOT NULL,
    plaque_status text DEFAULT 'none'::text NOT NULL,
    sbt_status text DEFAULT 'none'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT adoptions_discount_amount_check CHECK ((discount_amount >= 0)),
    CONSTRAINT adoptions_paid_amount_check CHECK ((paid_amount >= 0)),
    CONSTRAINT adoptions_period CHECK ((end_date > start_date)),
    CONSTRAINT adoptions_plaque_status_check CHECK ((plaque_status = ANY (ARRAY['none'::text, 'requested'::text, 'issued'::text]))),
    CONSTRAINT adoptions_sbt_status_check CHECK ((sbt_status = ANY (ARRAY['none'::text, 'issued'::text]))),
    CONSTRAINT adoptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: adoptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.adoptions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.adoptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fund_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fund_transactions (
    id bigint NOT NULL,
    kind text NOT NULL,
    category text NOT NULL,
    amount integer NOT NULL,
    adoption_id bigint,
    target_tree_id bigint,
    target_district text,
    description text,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fund_common_expense_has_district CHECK (((kind <> 'expense'::text) OR (category <> 'common'::text) OR (target_district IS NOT NULL))),
    CONSTRAINT fund_deposit_has_adoption CHECK (((kind <> 'deposit'::text) OR (adoption_id IS NOT NULL))),
    CONSTRAINT fund_transactions_amount_check CHECK ((amount > 0)),
    CONSTRAINT fund_transactions_category_check CHECK ((category = ANY (ARRAY['plaque'::text, 'tree'::text, 'common'::text]))),
    CONSTRAINT fund_transactions_kind_check CHECK ((kind = ANY (ARRAY['deposit'::text, 'expense'::text]))),
    CONSTRAINT fund_tree_expense_has_tree CHECK (((kind <> 'expense'::text) OR (category <> 'tree'::text) OR (target_tree_id IS NOT NULL)))
);


--
-- Name: fund_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.fund_transactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.fund_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    type text NOT NULL,
    tree_id bigint,
    report_id bigint,
    fund_transaction_id bigint,
    title text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_fund CHECK (((type <> 'fund_used'::text) OR (fund_transaction_id IS NOT NULL))),
    CONSTRAINT notifications_report CHECK (((type <> 'report_resolved'::text) OR (report_id IS NOT NULL))),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['report_resolved'::text, 'fund_used'::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.records (
    id bigint NOT NULL,
    tree_id bigint NOT NULL,
    user_id bigint NOT NULL,
    type text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    water_amount_ml integer,
    checklist jsonb,
    photo_url text,
    location public.geography(Point,4326),
    verification text DEFAULT 'none'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT records_checklist CHECK (((type = 'observe'::text) = (checklist IS NOT NULL))),
    CONSTRAINT records_type_check CHECK ((type = ANY (ARRAY['water'::text, 'observe'::text, 'report'::text]))),
    CONSTRAINT records_verification_check CHECK ((verification = ANY (ARRAY['none'::text, 'location'::text, 'photo'::text]))),
    CONSTRAINT records_water_amount CHECK (((type = 'water'::text) = (water_amount_ml IS NOT NULL))),
    CONSTRAINT records_water_amount_ml_check CHECK ((water_amount_ml > 0))
);


--
-- Name: records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.records ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id bigint NOT NULL,
    record_id bigint NOT NULL,
    record_type text DEFAULT 'report'::text NOT NULL,
    category text NOT NULL,
    urgency text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    agency text NOT NULL,
    is_trusted boolean DEFAULT false NOT NULL,
    handled_by bigint,
    action_note text,
    inspected_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reports_category_check CHECK ((category = ANY (ARRAY['leaning'::text, 'broken_branch'::text, 'pest'::text, 'withering'::text, 'other'::text]))),
    CONSTRAINT reports_inspected_at CHECK (((status = 'pending'::text) OR (inspected_at IS NOT NULL))),
    CONSTRAINT reports_record_type_check CHECK ((record_type = 'report'::text)),
    CONSTRAINT reports_resolved_at CHECK (((status = 'resolved'::text) = (resolved_at IS NOT NULL))),
    CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'inspecting'::text, 'resolved'::text]))),
    CONSTRAINT reports_urgency_check CHECK ((urgency = ANY (ARRAY['low'::text, 'high'::text])))
);


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stories (
    id bigint NOT NULL,
    adoption_id bigint NOT NULL,
    tree_name text NOT NULL,
    body text NOT NULL,
    photo_url text,
    is_public boolean DEFAULT false NOT NULL,
    author_display text DEFAULT 'nickname'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stories_author_display_check CHECK ((author_display = ANY (ARRAY['real_name'::text, 'nickname'::text])))
);


--
-- Name: stories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.stories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.stories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: story_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.story_entries (
    id bigint NOT NULL,
    story_id bigint NOT NULL,
    body text NOT NULL,
    photo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: story_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.story_entries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.story_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: trees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trees (
    id bigint NOT NULL,
    source_key text NOT NULL,
    species text NOT NULL,
    location public.geography(Point,4326) NOT NULL,
    agency text NOT NULL,
    district text NOT NULL,
    dong text,
    road_name text,
    address text,
    water_need text DEFAULT 'normal'::text NOT NULL,
    health_status text DEFAULT 'good'::text NOT NULL,
    status_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trees_health_status_check CHECK ((health_status = ANY (ARRAY['good'::text, 'check'::text, 'urgent'::text]))),
    CONSTRAINT trees_water_need_check CHECK ((water_need = ANY (ARRAY['enough'::text, 'normal'::text, 'thirsty'::text])))
);


--
-- Name: trees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.trees ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.trees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    nickname text NOT NULL,
    real_name text,
    role text DEFAULT 'citizen'::text NOT NULL,
    agency text,
    education_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_officer_has_agency CHECK (((role <> 'officer'::text) OR (agency IS NOT NULL))),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['citizen'::text, 'officer'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: weather; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather (
    date date NOT NULL,
    region text NOT NULL,
    precipitation_mm numeric(6,1) DEFAULT 0 NOT NULL,
    temp_avg numeric(4,1),
    temp_max numeric(4,1),
    is_heatwave boolean DEFAULT false NOT NULL
);


--
-- Name: adoptions adoptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adoptions
    ADD CONSTRAINT adoptions_pkey PRIMARY KEY (id);


--
-- Name: fund_transactions fund_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: records records_id_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_id_type_key UNIQUE (id, type);


--
-- Name: records records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_record_id_key UNIQUE (record_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: stories stories_adoption_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_adoption_id_key UNIQUE (adoption_id);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: story_entries story_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_entries
    ADD CONSTRAINT story_entries_pkey PRIMARY KEY (id);


--
-- Name: trees trees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trees
    ADD CONSTRAINT trees_pkey PRIMARY KEY (id);


--
-- Name: trees trees_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trees
    ADD CONSTRAINT trees_source_key_key UNIQUE (source_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: weather weather_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather
    ADD CONSTRAINT weather_pkey PRIMARY KEY (date, region);


--
-- Name: adoptions_one_active_per_tree; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX adoptions_one_active_per_tree ON public.adoptions USING btree (tree_id) WHERE (status = 'active'::text);


--
-- Name: adoptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX adoptions_user_idx ON public.adoptions USING btree (user_id);


--
-- Name: fund_transactions_adoption_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_transactions_adoption_idx ON public.fund_transactions USING btree (adoption_id);


--
-- Name: fund_transactions_tree_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fund_transactions_tree_idx ON public.fund_transactions USING btree (target_tree_id);


--
-- Name: notifications_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_time_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: records_tree_type_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_tree_type_time_idx ON public.records USING btree (tree_id, type, recorded_at DESC);


--
-- Name: records_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_user_idx ON public.records USING btree (user_id);


--
-- Name: reports_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_queue_idx ON public.reports USING btree (agency, is_trusted DESC, urgency, created_at) WHERE (status <> 'resolved'::text);


--
-- Name: story_entries_story_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX story_entries_story_idx ON public.story_entries USING btree (story_id);


--
-- Name: trees_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trees_agency_idx ON public.trees USING btree (agency);


--
-- Name: trees_district_dong_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trees_district_dong_idx ON public.trees USING btree (district, dong);


--
-- Name: trees_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trees_location_idx ON public.trees USING gist (location);


--
-- Name: trees_water_need_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trees_water_need_idx ON public.trees USING btree (water_need) WHERE (water_need = 'thirsty'::text);


--
-- Name: adoptions adoptions_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adoptions
    ADD CONSTRAINT adoptions_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.trees(id);


--
-- Name: adoptions adoptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adoptions
    ADD CONSTRAINT adoptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: fund_transactions fund_transactions_adoption_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_adoption_id_fkey FOREIGN KEY (adoption_id) REFERENCES public.adoptions(id);


--
-- Name: fund_transactions fund_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: fund_transactions fund_transactions_target_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fund_transactions
    ADD CONSTRAINT fund_transactions_target_tree_id_fkey FOREIGN KEY (target_tree_id) REFERENCES public.trees(id);


--
-- Name: notifications notifications_fund_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_fund_transaction_id_fkey FOREIGN KEY (fund_transaction_id) REFERENCES public.fund_transactions(id);


--
-- Name: notifications notifications_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id);


--
-- Name: notifications notifications_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.trees(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: records records_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.trees(id);


--
-- Name: records records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: reports reports_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.users(id);


--
-- Name: reports reports_record_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_record_fk FOREIGN KEY (record_id, record_type) REFERENCES public.records(id, type);


--
-- Name: stories stories_adoption_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_adoption_id_fkey FOREIGN KEY (adoption_id) REFERENCES public.adoptions(id);


--
-- Name: story_entries story_entries_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_entries
    ADD CONSTRAINT story_entries_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261020092817');
