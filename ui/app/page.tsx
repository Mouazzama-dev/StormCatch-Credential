import Link from "next/link";

export default function Home() {
  return (
    <>
      <p className="eyebrow">Medicine delivery pilot</p>
      <h1>Choose your desk</h1>
      <p className="lead">The pharmacy loads the robot and issues a payload token at I-1. The ward checks the token at I-2 and confirms receipt, after which the token can never be used again.</p>
      <div className="desks">
        <Link href="/pickup" className="desk">
          <span className="eyebrow">I-1, pharmacy</span>
          <h2>Pickup desk</h2>
          <p>Check the robot, list what you load, issue the payload token.</p>
        </Link>
        <Link href="/dropoff" className="desk">
          <span className="eyebrow">I-2, ward</span>
          <h2>Drop-off desk</h2>
          <p>Check what the robot carries, then confirm receipt.</p>
        </Link>
      </div>
    </>
  );
}
