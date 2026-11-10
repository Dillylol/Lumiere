package com.pedropathing.revhub.drivetrains;

import com.pedropathing.revhub.FakeVar;

/** Test stand-in for Pedro Pathing 3's swerve pod config, whose {@code name} is a label, not a device. */
public class CoaxialPodConfig {
    public final FakeVar<String> name = new FakeVar<>();
    public final FakeVar<String> motorName = new FakeVar<>();
    public final FakeVar<String> servoName = new FakeVar<>();
}
