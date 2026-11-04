ALTER TABLE project_links ADD COLUMN communication_channel TEXT NOT NULL DEFAULT '' CONSTRAINT project_links_communication_channel_check CHECK (communication_channel IN ('','canva','site','instagram'));
--> statement-breakpoint
ALTER TABLE project_links ADD COLUMN communication_note TEXT NOT NULL DEFAULT '' CONSTRAINT project_links_communication_note_check CHECK (length(communication_note) <= 600 AND (communication_channel = 'canva' OR communication_note = ''));
