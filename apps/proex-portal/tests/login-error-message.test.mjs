import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../app/login-error-message.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {loginErrorMessage}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

test('Better Auth wrong credentials and unrecognized identifiers have the same safe Portuguese outcome',()=>{
 const expected='Identificador ou senha inválidos. Confira os dados e tente novamente.';
 for(const body of [{code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid email or password'},{error:'Invalid email or password'},{code:'INVALID_PASSWORD',message:'Invalid password'},{code:'USER_NOT_FOUND',message:'User not found'},{error:'Identificador ou senha inválidos, ou cadastro ainda não ativado.'}]) assert.equal(loginErrorMessage(body,401),expected);
 assert.equal(loginErrorMessage({message:'Invalid email or password'},400),expected);
});
test('expected limits, expiry and setup errors preserve actionable Portuguese instructions without raw provider text',()=>{
 assert.match(loginErrorMessage({code:'TOO_MANY_REQUESTS'},429),/Aguarde alguns minutos/);
 for(const code of ['invalid_password','PASSWORD_TOO_SHORT','PASSWORD_TOO_LONG'])assert.equal(loginErrorMessage({code},400,'reset'),'Use uma senha de 12 a 128 caracteres.');
 assert.match(loginErrorMessage({code:'TOKEN_EXPIRED'},410,'invite'),/convite.*Peça outro link/);
 assert.match(loginErrorMessage({code:'INVALID_TOKEN'},400,'reset'),/link.*Peça outro link/);
 assert.match(loginErrorMessage({code:'invalid_origin'},403),/Atualize a página/);
 assert.match(loginErrorMessage({code:'setup_completed'},409,'setup'),/já foi concluída/);
 assert.match(loginErrorMessage({code:'setup_forbidden'},403,'setup'),/código e o e-mail/);
});
test('unknown, malformed, nested or internal failures never echo raw details or claim valid credentials',()=>{
 for(const body of [null,[],{},{error:{message:'SQLITE_ERROR secret'}},{error:'SQLITE_ERROR database password=synthetic'},{message:'Failed to fetch'},{code:'UNRECOGNIZED',message:'Provider stack trace'}])assert.equal(loginErrorMessage(body,400),'Não foi possível entrar. Confira os dados e tente novamente.');
 assert.equal(loginErrorMessage({code:'INVALID_PASSWORD',error:'Stack'},503),'O acesso está temporariamente indisponível. Tente novamente em instantes.');
 assert.equal(loginErrorMessage({message:'Unknown error'},400,'invite'),'Não foi possível validar a conta. Confira os dados e o link recebido.');
 assert.equal(loginErrorMessage({code:'EMAIL_NOT_VERIFIED',message:'Email not verified'},403),'Não foi possível validar seu acesso. Procure a equipe responsável.');
});
