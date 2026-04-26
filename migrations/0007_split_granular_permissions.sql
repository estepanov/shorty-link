-- Split invites.manage and roles.manage into granular CRUD permissions.
-- Sessions and API keys stay as .manage but move to a new "user" group on the
-- frontend; the stored permission strings for them do not change.

UPDATE role
SET permissions = REPLACE(
  REPLACE(permissions, '"invites.manage"', '"invites.create","invites.read","invites.update","invites.delete"'),
  '"roles.manage"', '"roles.create","roles.read","roles.update","roles.delete"'
);

UPDATE apikey
SET permissions = REPLACE(
  REPLACE(permissions, '"invites.manage"', '"invites.create","invites.read","invites.update","invites.delete"'),
  '"roles.manage"', '"roles.create","roles.read","roles.update","roles.delete"'
);
