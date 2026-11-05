-- Empty institutional structure. Public templates are applied explicitly, never by migration.
CREATE TABLE institutional_structures (
 organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 source_label TEXT NOT NULL DEFAULT '' CHECK(length(source_label)<=120),
 source_revision TEXT NOT NULL DEFAULT '' CHECK(length(source_revision)<=40),
 source_issued_on TEXT CHECK(source_issued_on IS NULL OR (length(source_issued_on)=10 AND date(source_issued_on)=source_issued_on)),
 source_url TEXT CHECK(source_url IS NULL OR source_url='https://files.cercomp.ufg.br/weby/up/694/o/Estrutura_Organizacional_-_2026.pdf'),
 adapted INTEGER NOT NULL DEFAULT 0 CHECK(adapted IN(0,1)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE institutional_nodes (
 id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL REFERENCES institutional_structures(organization_id),
 parent_id TEXT,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 acronym TEXT NOT NULL DEFAULT '' CHECK(length(acronym)<=24),
 kind TEXT NOT NULL CHECK(kind IN('council','office','directorate','coordination','publication','unit')),
 relation TEXT NOT NULL CHECK(relation IN('root','subordination','governance')),
 position INTEGER NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 999),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','archived')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,parent_id) REFERENCES institutional_nodes(organization_id,id),
 CHECK((parent_id IS NULL AND relation='root') OR(parent_id IS NOT NULL AND relation!='root'))
);
CREATE INDEX institutional_nodes_org_idx ON institutional_nodes(organization_id,status,parent_id,position);
CREATE TABLE institutional_team_links (
 organization_id TEXT NOT NULL REFERENCES institutional_structures(organization_id),
 node_id TEXT NOT NULL,team_id TEXT NOT NULL REFERENCES followup_teams(id),
 created_at TEXT NOT NULL,revoked_at TEXT,
 PRIMARY KEY(organization_id,node_id,team_id),
 FOREIGN KEY(organization_id,node_id) REFERENCES institutional_nodes(organization_id,id)
);
CREATE INDEX institutional_links_team_idx ON institutional_team_links(team_id,revoked_at);
CREATE TRIGGER institutional_header_identity BEFORE UPDATE OF organization_id ON institutional_structures
WHEN NEW.organization_id!=OLD.organization_id BEGIN SELECT RAISE(ABORT,'structure_identity_immutable'); END;
CREATE TRIGGER institutional_node_identity BEFORE UPDATE OF id,organization_id ON institutional_nodes
WHEN NEW.id!=OLD.id OR NEW.organization_id!=OLD.organization_id BEGIN SELECT RAISE(ABORT,'structure_identity_immutable'); END;
CREATE TRIGGER institutional_node_parent_insert BEFORE INSERT ON institutional_nodes BEGIN
 SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM institutional_nodes WHERE id=NEW.parent_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE(ABORT,'structure_parent_inactive') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM institutional_nodes WHERE organization_id=NEW.organization_id)>=200 THEN RAISE(ABORT,'structure_node_limit') END;
 SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS(SELECT id,parent_id,1 FROM institutional_nodes WHERE id=NEW.parent_id AND organization_id=NEW.organization_id UNION ALL SELECT p.id,p.parent_id,a.depth+1 FROM institutional_nodes p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=NEW.organization_id) SELECT COALESCE(MAX(depth),0) FROM ancestors)>=8 THEN RAISE(ABORT,'structure_depth_limit') END;
END;
CREATE TRIGGER institutional_node_parent_update BEFORE UPDATE OF parent_id,status ON institutional_nodes BEGIN
 SELECT CASE WHEN (NEW.parent_id IS NOT OLD.parent_id OR (OLD.status='archived' AND NEW.status='active')) AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM institutional_nodes WHERE id=NEW.parent_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE(ABORT,'structure_parent_inactive') END;
 SELECT CASE WHEN NEW.parent_id=NEW.id OR EXISTS(WITH RECURSIVE descendants(id) AS(SELECT id FROM institutional_nodes WHERE parent_id=NEW.id AND organization_id=NEW.organization_id UNION SELECT p.id FROM institutional_nodes p JOIN descendants d ON p.parent_id=d.id WHERE p.organization_id=NEW.organization_id) SELECT 1 FROM descendants WHERE id=NEW.parent_id) THEN RAISE(ABORT,'structure_cycle') END;
 SELECT CASE WHEN NEW.parent_id IS NOT OLD.parent_id AND (WITH RECURSIVE ancestors(id,parent_id,depth) AS(SELECT id,parent_id,1 FROM institutional_nodes WHERE id=NEW.parent_id AND organization_id=NEW.organization_id UNION ALL SELECT p.id,p.parent_id,a.depth+1 FROM institutional_nodes p JOIN ancestors a ON p.id=a.parent_id WHERE p.organization_id=NEW.organization_id), descendants(id,depth) AS(SELECT NEW.id,1 UNION ALL SELECT p.id,d.depth+1 FROM institutional_nodes p JOIN descendants d ON p.parent_id=d.id WHERE p.organization_id=NEW.organization_id) SELECT COALESCE((SELECT MAX(depth) FROM ancestors),0)+(SELECT MAX(depth) FROM descendants))>8 THEN RAISE(ABORT,'structure_depth_limit') END;
 SELECT CASE WHEN NEW.status='archived' AND( EXISTS(SELECT 1 FROM institutional_nodes WHERE parent_id=NEW.id AND organization_id=NEW.organization_id AND status='active') OR EXISTS(SELECT 1 FROM institutional_team_links WHERE node_id=NEW.id AND organization_id=NEW.organization_id AND revoked_at IS NULL)) THEN RAISE(ABORT,'structure_archive_in_use') END;
END;
CREATE TRIGGER institutional_link_insert BEFORE INSERT ON institutional_team_links BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup_teams t JOIN institutional_nodes n ON n.organization_id=t.organization_id WHERE t.id=NEW.team_id AND n.id=NEW.node_id AND n.organization_id=NEW.organization_id AND t.status='active' AND n.status='active') THEN RAISE(ABORT,'structure_link_inactive') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM institutional_team_links WHERE organization_id=NEW.organization_id AND revoked_at IS NULL)>=500 THEN RAISE(ABORT,'structure_link_limit') END;
END;
CREATE TRIGGER institutional_link_update BEFORE UPDATE ON institutional_team_links BEGIN
 SELECT CASE WHEN NEW.organization_id!=OLD.organization_id OR NEW.node_id!=OLD.node_id OR NEW.team_id!=OLD.team_id THEN RAISE(ABORT,'structure_identity_immutable') END;
 SELECT CASE WHEN NEW.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM followup_teams t JOIN institutional_nodes n ON n.organization_id=t.organization_id WHERE t.id=NEW.team_id AND n.id=NEW.node_id AND n.organization_id=NEW.organization_id AND t.status='active' AND n.status='active') THEN RAISE(ABORT,'structure_link_inactive') END;
 SELECT CASE WHEN NEW.revoked_at IS NULL AND OLD.revoked_at IS NOT NULL AND (SELECT COUNT(*) FROM institutional_team_links WHERE organization_id=NEW.organization_id AND revoked_at IS NULL)>=500 THEN RAISE(ABORT,'structure_link_limit') END;
END;
