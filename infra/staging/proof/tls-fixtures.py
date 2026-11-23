"""Throwaway certificates only. Never upload this directory as CI evidence."""
import datetime as dt
import pathlib
import sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

root = pathlib.Path(sys.argv[1])
now = dt.datetime.now(dt.timezone.utc)

def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)

def cert(subject, issuer, public_key, signer, expired=False, ca=False):
    builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer)
        .public_key(public_key).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=3))
        .not_valid_after(now + dt.timedelta(days=-1 if expired else 2))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True))
    if not ca:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]), critical=False)
    return builder.sign(signer, hashes.SHA256())

for label in ['valid', 'rotated', 'wrong', 'expired-ca', 'expired-leaf']:
    directory = root / label
    directory.mkdir(mode=0o700)
    authority = key()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'SYNTHETIC CA')])
    ca = cert(name, name, authority.public_key(), authority, label == 'expired-ca', True)
    leaf = key()
    server = cert(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')]), name,
        leaf.public_key(), authority, label == 'expired-leaf')
    (directory / 'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (directory / 'server.crt').write_bytes(server.public_bytes(serialization.Encoding.PEM))
    private = directory / 'server.key'
    private.write_bytes(leaf.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    private.chmod(0o600)
