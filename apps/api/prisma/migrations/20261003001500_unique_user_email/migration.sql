-- Enforce one login identity per normalized email.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
