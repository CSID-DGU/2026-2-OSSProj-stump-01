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
-- Name: caregiver_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caregiver_applications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    tree_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    motivation text,
    reject_reason text,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT caregiver_applications_period CHECK ((period_end >= period_start)),
    CONSTRAINT caregiver_applications_reject_reason CHECK (((status <> 'rejected'::text) OR (reject_reason IS NOT NULL))),
    CONSTRAINT caregiver_applications_reviewed CHECK (((status <> ALL (ARRAY['approved'::text, 'rejected'::text])) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT caregiver_applications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'ended'::text])))
);


--
-- Name: caregiver_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.caregiver_applications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.caregiver_applications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: monthly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_reports (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    agency text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    total_minutes integer NOT NULL,
    review_note text,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT monthly_reports_reviewed CHECK (((status = 'submitted'::text) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))),
    CONSTRAINT monthly_reports_revision_note CHECK (((status <> 'revision_requested'::text) OR (review_note IS NOT NULL))),
    CONSTRAINT monthly_reports_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'revision_requested'::text]))),
    CONSTRAINT monthly_reports_total_minutes_check CHECK ((total_minutes >= 0))
);


--
-- Name: monthly_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.monthly_reports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.monthly_reports_id_seq
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
    title text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_report CHECK (((type <> 'report_resolved'::text) OR (report_id IS NOT NULL))),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['application_result'::text, 'monthly_report_result'::text, 'rental_result'::text, 'report_resolved'::text, 'story_reaction'::text])))
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
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id bigint NOT NULL,
    organization_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: organization_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organization_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id bigint NOT NULL,
    name text NOT NULL,
    invite_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.organizations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organizations_id_seq
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
    photo_url text,
    location public.geography(Point,4326),
    verification text DEFAULT 'none'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activity_date date,
    activity_kind text,
    duration_min integer,
    memo text,
    monthly_report_id bigint,
    CONSTRAINT records_activity_fields CHECK (((type <> 'activity'::text) OR ((activity_date IS NOT NULL) AND (duration_min IS NOT NULL)))),
    CONSTRAINT records_duration_min_check CHECK ((duration_min > 0)),
    CONSTRAINT records_report_not_in_monthly CHECK (((type = 'activity'::text) OR (monthly_report_id IS NULL))),
    CONSTRAINT records_type_check CHECK ((type = ANY (ARRAY['activity'::text, 'report'::text]))),
    CONSTRAINT records_verification_check CHECK ((verification = ANY (ARRAY['none'::text, 'location'::text, 'photo'::text])))
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
-- Name: rental_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rental_items (
    id bigint NOT NULL,
    agency text NOT NULL,
    name text NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rental_items_stock_check CHECK ((stock >= 0))
);


--
-- Name: rental_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rental_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rental_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rentals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rentals (
    id bigint NOT NULL,
    item_id bigint NOT NULL,
    user_id bigint NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    handled_by bigint,
    handled_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rentals_handled CHECK (((status = 'requested'::text) OR ((handled_by IS NOT NULL) AND (handled_at IS NOT NULL)))),
    CONSTRAINT rentals_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT rentals_received_at CHECK (((status = 'received'::text) = (received_at IS NOT NULL))),
    CONSTRAINT rentals_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'received'::text])))
);


--
-- Name: rentals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.rentals ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rentals_id_seq
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
    tree_name text NOT NULL,
    body text NOT NULL,
    photo_url text,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tree_id bigint NOT NULL
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id bigint NOT NULL,
    author_display text DEFAULT 'nickname'::text NOT NULL,
    CONSTRAINT story_entries_author_display_check CHECK ((author_display = ANY (ARRAY['real_name'::text, 'nickname'::text])))
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
-- Name: story_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.story_reactions (
    id bigint NOT NULL,
    story_entry_id bigint NOT NULL,
    kind text NOT NULL,
    body text,
    device_key text NOT NULL,
    reacted_on date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul'::text))::date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT story_reactions_body CHECK ((((kind = 'reply'::text) AND (body IS NOT NULL) AND ((char_length(body) >= 1) AND (char_length(body) <= 80))) OR ((kind = 'like'::text) AND (body IS NULL)))),
    CONSTRAINT story_reactions_kind_check CHECK ((kind = ANY (ARRAY['like'::text, 'reply'::text])))
);


--
-- Name: story_reactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.story_reactions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.story_reactions_id_seq
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
    health_status text DEFAULT 'good'::text NOT NULL,
    status_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trees_health_status_check CHECK ((health_status = ANY (ARRAY['good'::text, 'check'::text, 'urgent'::text])))
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
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    badge_code text NOT NULL,
    earned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_badges ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_badges_id_seq
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
-- Name: volunteer_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_hours (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    monthly_report_id bigint NOT NULL,
    minutes integer NOT NULL,
    recorded_by bigint NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_hours_minutes_check CHECK ((minutes > 0))
);


--
-- Name: volunteer_hours_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_hours ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.volunteer_hours_id_seq
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
-- Name: caregiver_applications caregiver_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caregiver_applications
    ADD CONSTRAINT caregiver_applications_pkey PRIMARY KEY (id);


--
-- Name: monthly_reports monthly_reports_id_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_id_user_key UNIQUE (id, user_id);


--
-- Name: monthly_reports monthly_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_org_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_org_user_key UNIQUE (organization_id, user_id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_invite_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_invite_code_key UNIQUE (invite_code);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


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
-- Name: rental_items rental_items_agency_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_items
    ADD CONSTRAINT rental_items_agency_name_key UNIQUE (agency, name);


--
-- Name: rental_items rental_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rental_items
    ADD CONSTRAINT rental_items_pkey PRIMARY KEY (id);


--
-- Name: rentals rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_pkey PRIMARY KEY (id);


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
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: stories stories_tree_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_tree_id_key UNIQUE (tree_id);


--
-- Name: story_entries story_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_entries
    ADD CONSTRAINT story_entries_pkey PRIMARY KEY (id);


--
-- Name: story_reactions story_reactions_once_a_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_once_a_day UNIQUE (story_entry_id, device_key, reacted_on);


--
-- Name: story_reactions story_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_pkey PRIMARY KEY (id);


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
-- Name: user_badges user_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);


--
-- Name: user_badges user_badges_user_badge_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_badge_key UNIQUE (user_id, badge_code);


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
-- Name: volunteer_hours volunteer_hours_monthly_report_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_hours
    ADD CONSTRAINT volunteer_hours_monthly_report_id_key UNIQUE (monthly_report_id);


--
-- Name: volunteer_hours volunteer_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_hours
    ADD CONSTRAINT volunteer_hours_pkey PRIMARY KEY (id);


--
-- Name: weather weather_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather
    ADD CONSTRAINT weather_pkey PRIMARY KEY (date, region);


--
-- Name: caregiver_applications_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX caregiver_applications_one_open ON public.caregiver_applications USING btree (user_id, tree_id) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));


--
-- Name: caregiver_applications_tree_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX caregiver_applications_tree_status_idx ON public.caregiver_applications USING btree (tree_id, status);


--
-- Name: caregiver_applications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX caregiver_applications_user_idx ON public.caregiver_applications USING btree (user_id);


--
-- Name: monthly_reports_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_reports_queue_idx ON public.monthly_reports USING btree (agency, submitted_at) WHERE (status = 'submitted'::text);


--
-- Name: monthly_reports_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX monthly_reports_user_idx ON public.monthly_reports USING btree (user_id);


--
-- Name: notifications_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_time_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: organization_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_members_user_idx ON public.organization_members USING btree (user_id);


--
-- Name: records_monthly_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_monthly_report_idx ON public.records USING btree (monthly_report_id);


--
-- Name: records_tree_type_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_tree_type_time_idx ON public.records USING btree (tree_id, type, recorded_at DESC);


--
-- Name: records_unreported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_unreported_idx ON public.records USING btree (user_id, activity_date) WHERE ((type = 'activity'::text) AND (monthly_report_id IS NULL));


--
-- Name: records_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX records_user_idx ON public.records USING btree (user_id);


--
-- Name: rentals_item_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rentals_item_status_idx ON public.rentals USING btree (item_id, status);


--
-- Name: rentals_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rentals_user_idx ON public.rentals USING btree (user_id);


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
-- Name: volunteer_hours_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_hours_user_idx ON public.volunteer_hours USING btree (user_id, recorded_at);


--
-- Name: caregiver_applications caregiver_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caregiver_applications
    ADD CONSTRAINT caregiver_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: caregiver_applications caregiver_applications_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caregiver_applications
    ADD CONSTRAINT caregiver_applications_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.trees(id);


--
-- Name: caregiver_applications caregiver_applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caregiver_applications
    ADD CONSTRAINT caregiver_applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: monthly_reports monthly_reports_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: monthly_reports monthly_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_reports
    ADD CONSTRAINT monthly_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


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
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: records records_monthly_report_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.records
    ADD CONSTRAINT records_monthly_report_fk FOREIGN KEY (monthly_report_id, user_id) REFERENCES public.monthly_reports(id, user_id);


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
-- Name: rentals rentals_handled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.users(id);


--
-- Name: rentals rentals_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.rental_items(id);


--
-- Name: rentals rentals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


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
-- Name: stories stories_tree_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_tree_id_fkey FOREIGN KEY (tree_id) REFERENCES public.trees(id);


--
-- Name: story_entries story_entries_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_entries
    ADD CONSTRAINT story_entries_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE CASCADE;


--
-- Name: story_entries story_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_entries
    ADD CONSTRAINT story_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: story_reactions story_reactions_story_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.story_reactions
    ADD CONSTRAINT story_reactions_story_entry_id_fkey FOREIGN KEY (story_entry_id) REFERENCES public.story_entries(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: volunteer_hours volunteer_hours_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_hours
    ADD CONSTRAINT volunteer_hours_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: volunteer_hours volunteer_hours_report_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_hours
    ADD CONSTRAINT volunteer_hours_report_fk FOREIGN KEY (monthly_report_id, user_id) REFERENCES public.monthly_reports(id, user_id);


--
-- Name: volunteer_hours volunteer_hours_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_hours
    ADD CONSTRAINT volunteer_hours_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261020092817'),
    ('20261112120000');
