package dev.lumiere.ftc.live;

import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.pedro.PedroCommands;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;

/**
 * How Lumière Live drives Pedro Pathing: through the team's own follower on a robot, or a stand-in in
 * the library's tests, where no follower can be built.
 */
interface LiveDrive {
    void setPose(Pose pose);

    void update();

    /** Stops following and holding, and stops the drive motors. */
    void stop();

    Pose pose();

    /** The command a generated OpMode uses to follow a path: Ivy's {@code PedroCommands.follow}. */
    Command follow(Path path);

    /** The follower, for live data, or null for a stand-in. */
    Follower follower();

    /** The team's follower, used exactly as a generated OpMode uses it. */
    final class Pedro implements LiveDrive {
        private final Follower follower;

        Pedro(Follower follower) {
            this.follower = follower;
        }

        @Override
        public void setPose(Pose pose) {
            follower.setPose(pose);
        }

        @Override
        public void update() {
            follower.update();
        }

        @Override
        public void stop() {
            follower.stop();
        }

        @Override
        public Pose pose() {
            return follower.pose();
        }

        @Override
        public Command follow(Path path) {
            return PedroCommands.follow(follower, path);
        }

        @Override
        public Follower follower() {
            return follower;
        }
    }
}
